/**
 * Plan Generation Module (计划生成模块) — Call A (Planner)
 * 
 * 这是系统的 Planner（计划器），负责将用户的自然语言请求转换为可执行的计划。
 * 
 * ## 核心职责
 * 
 * **单一职责**: 生成严格的 JSON 计划，包含具体的工具调用和参数。
 * 
 * Planner 不做的事情：
 * - 不执行工具（那是 Executor 的工作）
 * - 不生成最终答案（那是 Reporter 的工作）
 * - 不进行推理（只生成计划结构）
 * 
 * ## 计划结构
 * 
 * 计划是一个 JSON 对象，包含：
 * - `intent`: 用户意图的简短描述
 * - `steps`: 执行步骤数组
 *   - `id`: 步骤 ID（如 "s1", "s2"）
 *   - `tool`: 工具 ID（必须来自注册表）
 *   - `description`: 步骤描述（中文）
 *   - `args`: 工具参数（可以包含变量引用）
 *   - `saveAs`: 结果保存的变量名（可选）
 *   - `dependsOn`: 依赖的步骤 ID（可选）
 * - `requiredPermissions`: 所需权限列表
 * 
 * ## 处理流程
 * 
 * 1. **构建提示词**:
 *    - 角色定义（中文 Planner）
 *    - 工具目录（动态生成，根据平台过滤）
 *    - 重要规则（CRITICAL RULES）
 *    - Few-shot 示例
 *    - 用户请求
 * 
 * 2. **调用 LLM**: 使用 `textComplete()` 调用 Planner 模型
 * 
 * 3. **提取 JSON**: 从 LLM 输出中提取 JSON（可能包含 markdown 代码块）
 * 
 * 4. **修复 JSON**: 使用 `jsonrepair` 修复常见的 JSON 错误
 * 
 * 5. **规范化**: `normalizePlanDraft()` 处理各种 JSON 格式：
 *    - 单步骤对象 → 包装成数组
 *    - 不同键名（plan/steps, actions, tasks） → 统一为 steps
 *    - 缺失字段 → 自动推断
 * 
 * 6. **后处理**:
 *    - 清理 saveAs（移除 {{vars.}} 包装）
 *    - 自动推断 saveAs（如果模型忘记）
 *    - 过滤不需要的 file.save 步骤
 * 
 * 7. **验证**: 确保计划包含非空的 steps 数组
 * 
 * ## 模型选择
 * 
 * - 默认使用 `qwen2.5:1.5b`（快速、成本低）
 * - 可以通过 `OLLAMA_PLANNER_MODEL` 环境变量覆盖
 * - 温度设置为 0（确定性输出）
 * 
 * ## 错误处理
 * 
 * - JSON 解析失败：尝试修复，如果仍失败则抛出错误
 * - 计划格式错误：规范化处理，如果仍无效则抛出错误
 * - LLM 超时：10 分钟超时（可配置）
 * 
 * ## 示例输出
 * 
 * ```json
 * {
 *   "intent": "给查理发消息",
 *   "steps": [
 *     {
 *       "id": "s1",
 *       "tool": "contacts.apple",
 *       "description": "查找查理",
 *       "args": { "query": "查理" },
 *       "saveAs": "contact"
 *     },
 *     {
 *       "id": "s2",
 *       "tool": "imessage.send",
 *       "description": "发送消息",
 *       "args": {
 *         "handle": "{{vars.contact.handle}}",
 *         "message": "你好"
 *       },
 *       "dependsOn": ["s1"]
 *     }
 *   ],
 *   "requiredPermissions": ["contacts.read", "platform.send"]
 * }
 * ```
 */

import { nanoid } from "nanoid";
import { savePlan } from "../planStore.js";
import { textComplete } from "./llm.js";
import { jsonrepair } from "jsonrepair";
import { getTool, getToolCatalog, getToolIds } from "./tools/registry.js";

// ── types ────────────────────────────────────────────────

export type PlanStep = {
  id: string;
  /** Tool ID from the registry (e.g. "text.generate", "platform.send") */
  tool: string;
  /** Chinese description of what this step does */
  description: string;
  /** Tool arguments — may contain {{vars.NAME}} or {{vars.NAME.field}} refs */
  args: Record<string, any>;
  /** Store output in vars[saveAs] for use by later steps */
  saveAs?: string;
  /** Step IDs this depends on (informational for the UI) */
  dependsOn?: string[];
};

export type Plan = {
  planId: string;
  sessionId: string;
  createdAt: number;

  /** Original user prompt, verbatim */
  prompt: string;

  /** Free-form intent label */
  intent: string;

  /** Concrete execution steps */
  steps: PlanStep[];

  /** Union of all permissions required across all steps */
  requiredPermissions: string[];
};

// ── JSON extraction / repair ─────────────────────────────

function extractJsonObject(s: string): string {
  const t = (s ?? "").trim();

  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : t;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);

  return candidate;
}

function safeJsonParse(s: string): any {
  const candidate = extractJsonObject(s);
  const repaired = jsonrepair(candidate);
  return JSON.parse(repaired);
}

// ── validation ───────────────────────────────────────────

function validatePlanDraft(draft: any): {
  intent: string;
  steps: PlanStep[];
  requiredPermissions: string[];
} {
  if (!draft || typeof draft !== "object") {
    throw new Error("Plan draft must be an object, got: " + JSON.stringify(draft).slice(0, 200));
  }

  const intent = typeof draft.intent === "string" ? draft.intent : "unspecified";

  // The 1.5b model sometimes puts steps in different places — try to find them
  let steps: any[] | undefined;
  if (Array.isArray(draft.steps) && draft.steps.length > 0) {
    steps = draft.steps;
  } else if (Array.isArray(draft.plan) && draft.plan.length > 0) {
    steps = draft.plan;
  } else if (Array.isArray(draft.actions) && draft.actions.length > 0) {
    steps = draft.actions;
  } else if (Array.isArray(draft)) {
    steps = draft;
  } else {
    // Last resort: look for any array property
    for (const v of Object.values(draft)) {
      if (Array.isArray(v) && v.length > 0 && v[0]?.tool) {
        steps = v;
        break;
      }
    }
  }

  if (!steps || steps.length === 0) {
    console.error("[validatePlanDraft] no steps found in:", JSON.stringify(draft).slice(0, 500));
    throw new Error("Plan draft must include a non-empty steps array");
  }

  const allowedToolIds = new Set(getToolIds());
  const allPermissions = new Set<string>();
  const out: PlanStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || typeof s !== "object") {
      throw new Error(`Step ${i} must be an object`);
    }

    const toolId = s.tool;
    const id = typeof s.id === "string" ? s.id : `s${i + 1}`;

    // Validate tool exists in registry
    if (!allowedToolIds.has(toolId)) {
      throw new Error(`Step ${id}: tool not in registry: ${String(toolId)}`);
    }

    const tool = getTool(toolId)!;

    // Collect permissions
    for (const perm of tool.permissions) {
      allPermissions.add(perm);
    }

    const description =
      typeof s.description === "string" ? s.description : tool.name;
    const args =
      s.args && typeof s.args === "object" ? s.args : {};
    // Sanitize saveAs — small models write "{{vars.foo.bar}}" instead of "foo"
    let saveAs: string | undefined;
    if (typeof s.saveAs === "string") {
      saveAs = s.saveAs
        .replace(/^\{\{\s*vars\.\s*/, "")
        .replace(/\s*\}\}\s*$/, "")
        .replace(/\..+$/, "");
    }

    // Auto-infer saveAs when the model forgot it but later steps reference it
    if (!saveAs) {
      saveAs = inferSaveAs(toolId);
    }

    const dependsOn = Array.isArray(s.dependsOn)
      ? s.dependsOn.filter((d: any) => typeof d === "string")
      : undefined;

    out.push({ id, tool: toolId, description, args, saveAs, dependsOn });
  }

  return {
    intent,
    steps: out,
    requiredPermissions: Array.from(allPermissions),
  };
}

// ── auto-infer saveAs for tools that produce data ────────

const TOOL_SAVE_AS: Record<string, string> = {
  "contacts.apple": "contact",
  "text.generate": "msg",
  "image.generate": "image",
  "web.search": "search",
  "email.read": "emails",
  "pdf.process": "pdf",
  "calendar.manage": "calendar",
  "reminders.manage": "reminder",
};

function inferSaveAs(toolId: string): string | undefined {
  return TOOL_SAVE_AS[toolId];
}

function extractCurrentRequest(prompt: string): string {
  const marker = "[当前请求]";
  const idx = prompt.lastIndexOf(marker);
  if (idx < 0) return prompt.trim();
  return prompt.slice(idx + marker.length).trim();
}

function isFlightRequest(prompt: string): boolean {
  const t = extractCurrentRequest(prompt);
  return /(search\s+flights?|\bflight\b|\bflights\b|google\s*flights|航班|机票|from\s+.+\s+to\s+.+)/i.test(t);
}

function isOpenPageRequest(prompt: string): boolean {
  const t = extractCurrentRequest(prompt);
  return /\bopen\s+(gmail|chatgpt|openai|amazon|https?:\/\/\S+)\b/i.test(t) ||
    /\b(navigate|go)\s+to\s+(gmail|chatgpt|openai|amazon|https?:\/\/\S+)\b/i.test(t) ||
    /(打开|访问)\s*(gmail|chatgpt|openai|amazon)/i.test(t);
}

const OPEN_PAGE_SITE_MAP: Record<string, string> = {
  gmail: "https://mail.google.com",
  chatgpt: "https://chatgpt.com",
  openai: "https://openai.com",
  amazon: "https://www.amazon.com",
};

function inferOpenPageStepFromPrompt(prompt: string): PlanStep | null {
  const t = extractCurrentRequest(prompt).replace(/\s+/g, " ").trim();

  // Match "open <site>" or "navigate to <site>" patterns
  const m = t.match(/(?:open|navigate\s+to|go\s+to|打开|访问)\s+([a-zA-Z0-9._\-/: ]+)/i);
  if (m) {
    const raw = m[1].trim().toLowerCase().replace(/\s+/g, "");
    const url = OPEN_PAGE_SITE_MAP[raw] ?? (raw.startsWith("http") ? raw : `https://${raw}`);
    return {
      id: "s1",
      tool: "browser.open_page",
      description: "打开网页",
      args: { url },
      saveAs: "page",
    };
  }
  return null;
}

function isSearchWebRequest(prompt: string): boolean {
  const t = extractCurrentRequest(prompt);
  // Match web-search intent but exclude flight-search phrases handled by browser.search_flights
  const isFlightSearchMatch = /(search\s+flights?|\bflight\b|\bflights\b|google\s*flights|航班|机票)/i.test(t);
  if (isFlightSearchMatch) return false;
  return /\bsearch\b|\blook\s+up\b|\bfind\b|\bwhat\s+is\b|\bwho\s+is\b|\bwhat\s+are\b|\bweather\b|\bnews\b|\blatest\b|\bprice\s+of\b/i.test(t) ||
    /\b搜索\b|\b查找\b|\b查询\b|\b查一下\b|\b天气\b|\b新闻\b|\b最新\b/i.test(t);
}

function inferSearchWebStepFromPrompt(prompt: string): PlanStep | null {
  const t = extractCurrentRequest(prompt).replace(/\s+/g, " ").trim();

  // Extract the query: strip leading verb like "Search", "Look up", "Find", "搜索"
  const cleaned = t
    .replace(/^(search\s+(for\s+)?|look\s+up\s+|find\s+|搜索一下\s*|搜索\s*|查找\s*|查询\s*|查一下\s*)/i, "")
    .trim();

  const query = cleaned || t;

  return {
    id: "s1",
    tool: "browser.search_web",
    description: "搜索网页",
    args: { query },
    saveAs: "search",
  };
}

function isExtractPageRequest(prompt: string): boolean {
  const t = extractCurrentRequest(prompt);
  return /\b(summarize|summary|extract|read)\s+(this\s+)?(page|article|content|text|current\s+page)\b/i.test(t) ||
    /\bwhat\s+(does\s+this\s+page|is\s+on\s+this\s+page)\b/i.test(t) ||
    /\b(总结|提取|阅读|读取)\s*(这个|当前|此)?\s*(页面|网页|文章|内容)\b/i.test(t) ||
    /\b(这个?|当前)\s*页面\s*(说了什么|讲了什么|内容是什么)\b/i.test(t);
}

function inferExtractPageStep(): PlanStep {
  return {
    id: "s1",
    tool: "browser.extract_page",
    description: "提取当前页面内容",
    args: { mode: "current_page" },
    saveAs: "page",
  };
}

function normalizeNaturalDate(raw: string | undefined, currentDate: Date): string | undefined {
  if (!raw) return undefined;
  const token = raw.trim().replace(/[.。！？!?,，]$/g, "");
  if (!token) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;

  const withYear = new Date(`${token} ${currentDate.getFullYear()}`);
  if (!Number.isNaN(withYear.getTime())) {
    return withYear.toISOString().slice(0, 10);
  }

  const direct = new Date(token);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  return undefined;
}

function inferFlightStepFromPrompt(prompt: string, currentDate: Date): PlanStep | null {
  const t = extractCurrentRequest(prompt).replace(/\s+/g, " ").trim();

  const en = t.match(/from\s+([A-Za-z .'-]+?)\s+to\s+([A-Za-z .'-]+?)(?:\s+(?:for|on)\s+([A-Za-z0-9,\- ]+))?(?:$|[.?!])/i);
  if (en) {
    const origin = en[1].trim();
    const destination = en[2].trim();
    const date = normalizeNaturalDate(en[3], currentDate);
    if (origin && destination) {
      return {
        id: "s1",
        tool: "browser.search_flights",
        description: "在Google Flights搜索航班",
        args: {
          origin,
          destination,
          ...(date ? { date } : {}),
        },
        saveAs: "flights",
      };
    }
  }

  return null;
}

// ── normalize LLM output into plan shape ─────────────────

/**
 * The 1.5b model produces various JSON shapes. This normalizes them all
 * into { intent, steps: [...] }.
 */
function normalizePlanDraft(parsed: any): any {
  if (!parsed || typeof parsed !== "object") return parsed;

  // Case 1: already correct { steps: [...] }
  if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
    return parsed;
  }

  // Case 2: single step object { tool: "...", ... }
  if (parsed.tool && typeof parsed.tool === "string") {
    console.log("[normalize] single step object → wrapping in steps array");
    return {
      intent: parsed.description ?? "unspecified",
      steps: [{ ...parsed, id: parsed.id ?? "s1" }],
    };
  }

  // Case 3: bare array of steps [{ tool: "..." }, ...]
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.tool) {
    console.log("[normalize] bare array → wrapping");
    return { intent: "unspecified", steps: parsed };
  }

  // Case 4: nested under a different key (plan, actions, tasks, etc.)
  for (const key of ["plan", "actions", "tasks", "execution", "workflow"]) {
    const val = parsed[key];
    if (Array.isArray(val) && val.length > 0) {
      console.log(`[normalize] found steps under "${key}"`);
      return { ...parsed, steps: val };
    }
  }

  // Case 5: any array-valued property that contains objects with "tool"
  for (const [key, val] of Object.entries(parsed)) {
    if (Array.isArray(val) && val.length > 0 && (val[0] as any)?.tool) {
      console.log(`[normalize] found tool-steps under "${key}"`);
      return { ...parsed, steps: val };
    }
  }

  // Can't normalize — return as-is, let validatePlanDraft throw with good error
  return parsed;
}

// ── plan generation with ONE repair attempt ──────────────

async function planWithRepair(plannerInstruction: string) {
  let raw = await textComplete({
    prompt: plannerInstruction,
    role: "planner",
    forceJson: true,
  });

  console.log("[planWithRepair] raw LLM output:", raw.slice(0, 800));

  try {
    const parsed = safeJsonParse(raw);
    return normalizePlanDraft(parsed);
  } catch (e) {
    console.warn("[planWithRepair] parse failed:", (e as Error).message);
  }

  // Repair attempt
  const repairPrompt = `
Return ONLY valid JSON. No markdown. No extra text.

The previous output was invalid JSON. Fix ONLY the formatting.
Do not change the content or meaning.

Invalid output:
${raw}
`.trim();

  raw = await textComplete({
    prompt: repairPrompt,
    role: "planner",
    forceJson: true,
  });

  return safeJsonParse(raw);
}

// ── public API ───────────────────────────────────────────

export async function createPlan(args: {
  sessionId: string;
  prompt: string;
  intent?: string;
  platform?: string;
}): Promise<Plan> {
  const prompt = (args.prompt ?? "").trim();
  if (!prompt) throw new Error("Prompt is required");

  const planId = nanoid();
  const platform = args.platform ?? "wecom";

  // Build tool catalog — only show tools relevant to this platform
  const toolCatalog = getToolCatalog(platform);

  // DEBUG: Log tool catalog to verify browser.search_flights is present
  console.log("[createPlan] TOOL CATALOG FOR PLANNER:");
  console.log(toolCatalog);
  console.log("[createPlan] --- END TOOL CATALOG ---");

  // Pick platform-specific send example (2 steps: lookup + send with DIRECT message)
  const sendTool = platform === "imessage" ? "imessage.send" : platform === "sms" ? "sms.send" : platform === "wechat" ? "wechat.send" : "platform.send";
  // Always use contacts.apple — iPhone contacts sync to Mac via iCloud
  const contactTool = "contacts.apple";
  const contactArgs = `"query":"PERSON_NAME"`;
  const sendArgs = platform === "imessage"
    ? `"handle":"{{vars.contact.handle}}","recipientName":"{{vars.contact.name}}","message":"THE_MESSAGE"`
    : platform === "wechat"
    ? `"recipient":"{{vars.contact.name}}","message":"THE_MESSAGE"`
    : platform === "sms"
    ? `"recipientPhone":"{{vars.contact.phone}}","recipientName":"{{vars.contact.name}}","message":"THE_MESSAGE"`
    : `"recipientId":"{{vars.contact.id}}","recipientName":"{{vars.contact.name}}","platform":"${platform}","message":"THE_MESSAGE"`;

  const now = new Date();
  const currentDateStr = now.toISOString().split("T")[0];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDay = dayNames[now.getDay()];

  const plannerInstruction = `
Return ONLY valid JSON. No markdown.

You are Alfred (阿福), an AI personal assistant. Current date: ${currentDateStr} (${currentDay}). Produce a multi-step plan. Steps share data via "saveAs"/"{{vars.x.field}}".

Tools:
${toolCatalog}

CRITICAL RULES:
1. If the user gives a DIRECT message to send (e.g. "说明天吃什么"), put that text directly in the send tool's "message" arg. Do NOT use text.generate.
2. Only use text.generate when the user asks to COMPOSE/WRITE something (e.g. "写一封邀请函", "帮我想一段祝福语").
3. If the user already provides a direct address (phone/email/wxid) or a WeChat system name (文件传输助手/filehelper), send directly without contact lookup.
4. If no direct address is provided, FIRST look up the contact, THEN send. For WeChat, the recipient can be a name — wechat.send will resolve it.
5. Each step needs: id, tool, description (Chinese), args. saveAs must be a plain name like "contact".
6. For email operations: use email.send to send, email.read to search/read inbox.
7. For calendar: use calendar.manage with action "create"/"list"/"update"/"delete". Use symbolic dates like "TODAY", "TOMORROW", "TODAY_15:00", "TOMORROW_20:00", or ISO dates like "${currentDateStr}T15:00:00Z".
8. For reminders/tasks: use reminders.manage with action "create"/"complete"/"list"/"delete". Use "TODAY", "TOMORROW", or ISO date for due_date.
9. For web searches (NOT including flights): use web.search. After searching, add a text.generate step to format results if user wants a summary.
10. For PDF documents: use pdf.process with action "extract_text"/"summarize"/"answer_question". If the user message contains "[Attached file: FILENAME]", use that FILENAME as the file_id in pdf.process args.
11. For compound requests (e.g. "schedule dinner and send him a message"), create multiple steps in one plan.
12. For FLIGHT SEARCHES (e.g. "搜航班", "search flights", "New York to Detroit", "机票"): ALWAYS use browser.search_flights. This tool opens a real browser on the user's machine to search Google Flights and returns live results. Do NOT use web.search or flights.search for flight queries.
13. For OPEN PAGE requests (e.g. "Open Gmail", "Open ChatGPT", "Open Amazon", "Open OpenAI", "打开谷歌", "go to openai.com"): ALWAYS use browser.open_page. Use built-in mappings: gmail→https://mail.google.com, chatgpt→https://chatgpt.com, openai→https://openai.com, amazon→https://www.amazon.com. If the user provides a full URL, use it directly.
14. For WEB SEARCH requests (e.g. "Search Ann Arbor weather", "Search best coffee shops", "Look up OpenAI blog", "查找最新消息", "搜索天气"): ALWAYS use browser.search_web. Use the user's query as the "query" arg. Strip leading verbs like "Search", "Look up", "搜索" from the query. Do NOT use web.search for these — browser.search_web opens a real browser.
15. For PAGE EXTRACT / SUMMARIZE requests (e.g. "summarize this page", "summarize the current page", "what does this page say", "extract page content", "总结这个页面", "这页说了什么"): ALWAYS use browser.extract_page with args {"mode":"current_page"}. This reads whatever page is currently open in the browser — no URL needed.

CLARIFICATION RULES:
- If the request is MISSING the recipient (who to send to), you MUST clarify.
- If the request is MISSING critical info but has enough context, make reasonable assumptions and proceed. Do NOT over-clarify.
- If the request is truly ambiguous or vague (e.g. "帮我安排一下", "plan something"), use clarify to ask ALL missing info in ONE question.
- Batch all questions into ONE clarify step. Ask multiple things at once, e.g. "请问：1) 发给谁？2) 什么时间？3) 有没有地点偏好？"
- Do NOT clarify if: user gives specific recipient + message content, or the task is self-contained (search, list calendar, read emails).

Example A — direct message "给查理说明天开会":
{"intent":"给查理发消息","steps":[{"id":"s1","tool":"${contactTool}","description":"查找查理","args":{${contactArgs.replace("PERSON_NAME", "查理")}},"saveAs":"contact"},{"id":"s2","tool":"${sendTool}","description":"发送消息","args":{${sendArgs.replace("THE_MESSAGE", "明天开会")}},"dependsOn":["s1"]}]}

Example B — compose + send "帮我写个生日祝福发给查理":
{"intent":"写生日祝福发给查理","steps":[{"id":"s1","tool":"text.generate","description":"生成祝福","args":{"prompt":"写一段简短的生日祝福语"},"saveAs":"msg"},{"id":"s2","tool":"${contactTool}","description":"查找查理","args":{${contactArgs.replace("PERSON_NAME", "查理")}},"saveAs":"contact"},{"id":"s3","tool":"${sendTool}","description":"发送消息","args":{${sendArgs.replace("THE_MESSAGE", "{{vars.msg.text}}")}},"dependsOn":["s1","s2"]}]}

Example C — direct address "给 ruiraywang97@gmail.com 发邮件说hello":
{"intent":"发送邮件","steps":[{"id":"s1","tool":"email.send","description":"发送邮件","args":{"to":"ruiraywang97@gmail.com","subject":"Hello","body":"Hello"}}]}

Example D — vague request needing clarification "帮我发个消息给朋友约晚饭":
{"intent":"需要澄清","steps":[{"id":"s1","tool":"clarify","description":"询问详情","args":{"question":"好的！我需要确认几个细节：\n1. 发给哪位朋友？\n2. 哪天的晚饭？\n3. 有没有时间和地点偏好？"}}]}

Example E — search "搜索一下最近的AI新闻":
{"intent":"搜索AI新闻","steps":[{"id":"s1","tool":"web.search","description":"搜索AI新闻","args":{"query":"latest AI news 2026"},"saveAs":"search"},{"id":"s2","tool":"text.generate","description":"整理搜索结果","args":{"prompt":"请根据以下搜索结果，用中文整理出一份简洁的新闻摘要：\n\n{{vars.search.results}}"},"dependsOn":["s1"]}]}

Example F — calendar "下周五晚上8点和Adam吃饭":
{"intent":"创建日历事件并发消息","steps":[{"id":"s1","tool":"calendar.manage","description":"创建晚餐日历事件","args":{"action":"create","title":"和Adam吃晚饭","start":"2026-03-13T20:00:00Z","end":"2026-03-13T21:30:00Z"},"saveAs":"calendar"},{"id":"s2","tool":"${contactTool}","description":"查找Adam","args":{${contactArgs.replace("PERSON_NAME", "Adam")}},"saveAs":"contact"},{"id":"s3","tool":"${sendTool}","description":"发送消息给Adam","args":{${sendArgs.replace("THE_MESSAGE", "Hey! 下周五晚上8点一起吃晚饭怎么样？")}},"dependsOn":["s1","s2"]}]}

Example G — reminder "提醒我明天给妈妈打电话":
{"intent":"创建提醒","steps":[{"id":"s1","tool":"reminders.manage","description":"创建提醒任务","args":{"action":"create","title":"给妈妈打电话","due_date":"TOMORROW"},"saveAs":"reminder"}]}

Example H — email "查看我的邮件":
{"intent":"查看邮件","steps":[{"id":"s1","tool":"email.read","description":"读取最新邮件","args":{"count":5},"saveAs":"emails"}]}

Example I — clear request, NO clarification needed "Text Adam to plan dinner Friday 8pm at Five Guys":
{"intent":"给Adam发消息约饭","steps":[{"id":"s1","tool":"${contactTool}","description":"查找Adam","args":{${contactArgs.replace("PERSON_NAME", "Adam")}},"saveAs":"contact"},{"id":"s2","tool":"${sendTool}","description":"发送晚餐邀请","args":{${sendArgs.replace("THE_MESSAGE", "Hey Adam, want to grab dinner at Five Guys this Friday at 8pm?")}},"dependsOn":["s1"]}]}

Example J — WeChat direct send "给文件传输助手发微信说测试":
{"intent":"发微信消息","steps":[{"id":"s1","tool":"wechat.send","description":"发送微信消息","args":{"recipient":"filehelper","message":"测试"}}]}

Example K — PDF "帮我总结这个PDF":
{"intent":"总结PDF","steps":[{"id":"s1","tool":"pdf.process","description":"总结PDF内容","args":{"file_id":"uploaded_file.pdf","action":"summarize"},"saveAs":"pdf"}]}

Example L — flight search "搜索纽约到底特律3月20日的航班":
{"intent":"搜索航班","steps":[{"id":"s1","tool":"browser.search_flights","description":"在Google Flights搜索航班","args":{"origin":"New York","destination":"Detroit","date":"2026-03-20"},"saveAs":"flights"}]}

Example M — open page "Open Gmail":
{"intent":"打开Gmail","steps":[{"id":"s1","tool":"browser.open_page","description":"打开Gmail网页","args":{"url":"https://mail.google.com"},"saveAs":"page"}]}

Example N — web search "Search Ann Arbor weather":
{"intent":"搜索天气","steps":[{"id":"s1","tool":"browser.search_web","description":"搜索Ann Arbor天气","args":{"query":"Ann Arbor weather"},"saveAs":"search"}]}

Example O — page summarize "Summarize the current page":
{"intent":"总结页面","steps":[{"id":"s1","tool":"browser.extract_page","description":"提取当前页面内容","args":{"mode":"current_page"},"saveAs":"page"}]}

User: ${prompt}
`.trim();

  console.log("[createPlan] calling planner…");

  const draft = await planWithRepair(plannerInstruction);
  let { intent, steps, requiredPermissions } = validatePlanDraft(draft);

  // Deterministic safeguard: flight requests should always use browser.search_flights.
  if (isFlightRequest(prompt)) {
    const hasBrowserFlights = steps.some((s) => s.tool === "browser.search_flights");
    if (!hasBrowserFlights) {
      const inferredStep = inferFlightStepFromPrompt(prompt, now);
      if (inferredStep) {
        steps = [inferredStep];
        intent = "搜索航班";
        requiredPermissions = ["browser.control"];
        console.log("[createPlan] planner selected browser.search_flights (deterministic override)");
      }
    }
  }

  // Deterministic safeguard: open-page requests should always use browser.open_page.
  if (isOpenPageRequest(prompt)) {
    const hasOpenPage = steps.some((s) => s.tool === "browser.open_page");
    if (!hasOpenPage) {
      const inferredStep = inferOpenPageStepFromPrompt(prompt);
      if (inferredStep) {
        steps = [inferredStep];
        intent = "打开网页";
        requiredPermissions = ["browser.control"];
        console.log("[createPlan] planner selected browser.open_page (deterministic override)");
      }
    }
  }

  // Deterministic safeguard: web-search requests should always use browser.search_web.
  if (isSearchWebRequest(prompt)) {
    const hasSearchWeb = steps.some((s) => s.tool === "browser.search_web");
    if (!hasSearchWeb) {
      const inferredStep = inferSearchWebStepFromPrompt(prompt);
      if (inferredStep) {
        steps = [inferredStep];
        intent = "搜索网页";
        requiredPermissions = ["browser.control"];
        console.log("[createPlan] planner selected browser.search_web (deterministic override)");
      }
    }
  }

  // Deterministic safeguard: page-summarize requests should always use browser.extract_page.
  if (isExtractPageRequest(prompt)) {
    const hasExtractPage = steps.some((s) => s.tool === "browser.extract_page");
    if (!hasExtractPage) {
      steps = [inferExtractPageStep()];
      intent = "总结当前页面";
      requiredPermissions = ["browser.control"];
      console.log("[createPlan] planner selected browser.extract_page (deterministic override)");
    }
  }

  // Post-process: strip file.save steps the user didn't ask for
  const wantsFile = /保存|存储|文件|save|file|导出|export/i.test(prompt);
  if (!wantsFile) {
    const before = steps.length;
    steps = steps.filter((s) => s.tool !== "file.save");
    if (steps.length < before) {
      console.log(`[createPlan] stripped ${before - steps.length} unwanted file.save step(s)`);
      // Recompute permissions
      const permsSet = new Set<string>();
      for (const s of steps) {
        const t = getTool(s.tool);
        if (t) for (const p of t.permissions) permsSet.add(p);
      }
      requiredPermissions = Array.from(permsSet);
    }
  }

  const plan: Plan = {
    planId,
    sessionId: args.sessionId,
    createdAt: Date.now(),
    prompt,
    intent: args.intent ?? intent,
    steps,
    requiredPermissions,
  };

  if (plan.steps.some((s) => s.tool === "browser.search_flights")) {
    if (!plan.requiredPermissions.includes("browser.control")) {
      plan.requiredPermissions = [...plan.requiredPermissions, "browser.control"];
    }
    console.log("[createPlan] planner selected browser.search_flights", {
      requiredPermissions: plan.requiredPermissions,
      steps: plan.steps.map((s) => s.tool),
    });
  }

  if (plan.steps.some((s) => s.tool === "browser.open_page")) {
    if (!plan.requiredPermissions.includes("browser.control")) {
      plan.requiredPermissions = [...plan.requiredPermissions, "browser.control"];
    }
    console.log("[createPlan] planner selected browser.open_page", {
      requiredPermissions: plan.requiredPermissions,
      steps: plan.steps.map((s) => s.tool),
    });
  }

  if (plan.steps.some((s) => s.tool === "browser.search_web")) {
    if (!plan.requiredPermissions.includes("browser.control")) {
      plan.requiredPermissions = [...plan.requiredPermissions, "browser.control"];
    }
    console.log("[createPlan] planner selected browser.search_web", {
      requiredPermissions: plan.requiredPermissions,
      steps: plan.steps.map((s) => s.tool),
    });
  }

  if (plan.steps.some((s) => s.tool === "browser.extract_page")) {
    if (!plan.requiredPermissions.includes("browser.control")) {
      plan.requiredPermissions = [...plan.requiredPermissions, "browser.control"];
    }
    console.log("[createPlan] planner selected browser.extract_page", {
      requiredPermissions: plan.requiredPermissions,
      steps: plan.steps.map((s) => s.tool),
    });
  }

  savePlan(planId, plan);
  return plan;
}
