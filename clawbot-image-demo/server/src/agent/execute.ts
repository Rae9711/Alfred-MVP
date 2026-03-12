/**
 * Plan Execution Module (计划执行模块)
 * 
 * 这是系统的核心执行引擎，负责按照 Planner 生成的计划执行工具调用。
 * 
 * ## 执行流程
 * 
 * 1. **变量解析** (resolveVars)
 *    - 解析步骤参数中的变量引用：{{vars.NAME}} 和 {{vars.NAME.field}}
 *    - 这是纯字符串替换，不涉及 LLM 推理
 *    - 如果变量不存在或字段缺失，返回 [missing: ...] 或 [error: ...]
 * 
 * 2. **工具查找** (getTool)
 *    - 从工具注册表中查找对应的工具定义
 *    - 如果工具不存在，标记为错误并继续下一步
 * 
 * 3. **工具执行** (tool.execute)
 *    - 在沙箱中执行工具（带超时保护）
 *    - 慢速工具（LLM、AppleScript）：5 分钟超时
 *    - 快速工具（本地操作）：10 秒超时
 * 
 * 4. **错误检测**
 *    - 检查工具返回结果中的 found === false 或 error 字段
 *    - 如果检测到错误，标记步骤为 error 状态
 *    - 但仍然保存结果到 vars（供后续步骤检查）
 * 
 * 5. **结果存储**
 *    - 将工具输出保存到 vars[step.saveAs]
 *    - saveAs 会被清理（移除 {{vars.}} 包装）
 * 
 * 6. **事件发送**
 *    - 通过 WebSocket 发送执行事件到前端
 *    - tool.start, tool.success, tool.error, agent.exec.step 等
 * 
 * ## 设计原则
 * 
 * - **确定性执行**: 工具执行是纯函数式的，不涉及 LLM 推理
 * - **错误容忍**: 失败被捕获而不是抛出，允许后续步骤继续执行
 * - **可观测性**: 每个步骤都发送事件，便于前端实时显示
 * - **变量共享**: 步骤之间通过 vars 对象共享数据
 * 
 * ## 示例
 * 
 * 计划步骤：
 * ```json
 * {
 *   "id": "s1",
 *   "tool": "contacts.apple",
 *   "args": { "query": "查理" },
 *   "saveAs": "contact"
 * }
 * ```
 * 
 * 执行后：
 * - vars.contact = { found: true, name: "查理", handle: "+1234567890" }
 * 
 * 下一步可以引用：
 * ```json
 * {
 *   "tool": "imessage.send",
 *   "args": { "handle": "{{vars.contact.handle}}" }
 * }
 * ```
 * 
 * 解析后：
 * - args.handle = "+1234567890"
 */

import { nanoid } from "nanoid";
import { getPlan } from "../planStore.js";
import { runSandboxed } from "../sandbox/sandboxRunner.js";
import {
  saveRun,
  type RunRecord,
  type StepResult,
  type ExecutionSummary,
} from "./executeStore.js";
import { getTool, type ToolContext } from "./tools/registry.js";
import type { Plan, PlanStep } from "./plan.js";

type StepExecuteHookInput = {
  sessionId: string;
  step: PlanStep;
  args: Record<string, any>;
  timeoutMs: number;
  ctx: ToolContext;
  localExecute: () => Promise<any>;
};

type StepExecuteHook = (input: StepExecuteHookInput) => Promise<any>;

// ── Variable Resolution (变量解析) ───────────────────────────────────────

/**
 * 解析值中的变量引用：{{vars.NAME}} 和 {{vars.NAME.field}}
 * 
 * 这个函数递归处理字符串、数组和对象，将所有变量引用替换为实际值。
 * 
 * ## 变量引用格式
 * 
 * - {{vars.contact}} → 整个 contact 对象（JSON 字符串）
 * - {{vars.contact.handle}} → contact 对象的 handle 字段
 * - {{vars.contact.name}} → contact 对象的 name 字段
 * 
 * ## 错误处理
 * 
 * 如果变量不存在：
 * - {{vars.missing}} → "[missing: missing]"
 * 
 * 如果变量存在但字段不存在：
 * - vars.contact = { name: "查理" }
 * - {{vars.contact.handle}} → "[missing: contact.handle (可用字段: name)]"
 * 
 * 如果上一步执行失败（found === false）：
 * - vars.contact = { found: false, error: "权限被拒绝" }
 * - {{vars.contact.handle}} → "[error: contact.handle - 权限被拒绝]"
 * 
 * ## 示例
 * 
 * ```typescript
 * const vars = {
 *   contact: { name: "查理", handle: "+123" },
 *   msg: { text: "你好" }
 * };
 * 
 * resolveVars("{{vars.contact.handle}}", vars)  // → "+123"
 * resolveVars("{{vars.msg.text}}", vars)        // → "你好"
 * resolveVars({ handle: "{{vars.contact.handle}}" }, vars)
 * // → { handle: "+123" }
 * ```
 * 
 * @param value - 要解析的值（可以是字符串、对象、数组）
 * @param vars - 变量存储对象
 * @returns 解析后的值
 */
function resolveVars(value: any, vars: Record<string, any>): any {
  if (typeof value === "string") {
    return value.replace(
      /\{\{\s*vars\.([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\s*\}\}/g,
      (_match, varName, field) => {
        const v = vars[varName];
        if (v === undefined) {
          return `[missing: ${varName}]`;
        }
        
        // Check if variable has an error (from failed tool execution)
        // If found === false, it means the tool failed to find/create the resource
        if (v && typeof v === "object") {
          if (v.error || (v.found === false)) {
            const errorMsg = v.error || "上一步执行失败（未找到资源）";
            if (field) {
              return `[error: ${varName}.${field} - ${errorMsg}]`;
            }
            return `[error: ${varName} - ${errorMsg}]`;
          }
        }
        
        if (field) {
          // First check if this is a failed tool result (found === false)
          if (v && typeof v === "object" && v.found === false) {
            const errorMsg = v.error || "上一步执行失败（未找到资源）";
            return `[error: ${varName}.${field} - ${errorMsg}]`;
          }
          
          const f = typeof v === "object" && v !== null ? v[field] : undefined;
          if (f === undefined || f === null) {
            // Provide helpful error message
            const availableFields = v && typeof v === "object" ? Object.keys(v).join(", ") : "无可用字段";
            return `[missing: ${varName}.${field} (可用字段: ${availableFields})]`;
          }
          return String(f);
        }
        return typeof v === "object" ? JSON.stringify(v) : String(v);
      },
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveVars(item, vars));
  }

  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveVars(v, vars);
    }
    return out;
  }

  return value;
}

// ── Timeout Configuration (超时配置) ─────────────────────

/**
 * 慢速工具集合
 * 
 * 这些工具需要较长的执行时间：
 * - text.generate: LLM 文本生成（可能很慢）
 * - image.generate: LLM 图片生成（可能很慢）
 * - contacts.apple: macOS JXA 调用（需要系统权限，可能较慢）
 * - imessage.send: macOS AppleScript 调用（需要系统权限，可能较慢）
 */
const SLOW_TOOLS = new Set(["text.generate", "image.generate", "contacts.apple", "imessage.send", "web.search"]);

/** 慢速工具超时时间：5 分钟 */
const SLOW_TIMEOUT = 300_000;

/** 快速工具超时时间：10 秒（本地操作，应该很快） */
const FAST_TIMEOUT = 10_000;

// ── Plan Executor (计划执行器) ─────────────────────────────────────────────

/**
 * 执行计划的所有步骤
 * 
 * 这是执行引擎的主函数，按顺序执行计划中的每个步骤。
 * 
 * ## 执行流程
 * 
 * 1. 验证计划已批准
 * 2. 创建执行记录（runId）
 * 3. 初始化变量存储（vars）和结果存储（stepResults）
 * 4. 遍历每个步骤：
 *    a. 发送步骤开始事件
 *    b. 查找工具
 *    c. 解析变量引用
 *    d. 执行工具（沙箱 + 超时）
 *    e. 检测错误
 *    f. 保存结果到 vars
 *    g. 发送步骤完成事件
 * 5. 构建执行摘要
 * 6. 保存执行记录
 * 
 * ## 错误处理策略
 * 
 * - 工具执行失败：标记为 error，但继续执行后续步骤
 * - 变量解析失败：返回 [missing: ...] 或 [error: ...]，工具可以处理
 * - 超时：标记为 timeout，继续执行
 * 
 * ## 事件发送
 * 
 * 通过 emit 函数发送以下事件：
 * - agent.exec.started: 执行开始
 * - agent.exec.step: 步骤状态更新（running/ok/error）
 * - tool.start: 工具开始执行
 * - tool.success: 工具执行成功
 * - tool.error: 工具执行失败
 * - agent.exec.finished: 执行完成
 * 
 * @param opts.sessionId - 会话 ID
 * @param opts.planId - 计划 ID（从 planStore 获取）
 * @param opts.approved - 是否已批准（必须为 true）
 * @param opts.emit - 事件发送函数（WebSocket）
 * @param opts.outboxDir - 输出目录（工具可以写入文件）
 * @returns 执行记录（包含所有步骤结果）
 */
export async function executePlan(opts: {
  sessionId: string;
  planId: string;
  approved: boolean;
  emit: (event: string, data: any) => void;
  outboxDir: string;
  executeTool?: StepExecuteHook;
}): Promise<RunRecord> {
  const plan = getPlan(opts.planId) as Plan;
  if (!opts.approved) throw new Error("Execution requires approval.");

  const runId = nanoid();
  opts.emit("agent.exec.started", { runId, planId: plan.planId });

  const stepResults: StepResult[] = [];
  const toolResults: Record<string, any> = {};
  const vars: Record<string, any> = {};

  for (let i = 0; i < plan.steps.length; i++) {
    const step: PlanStep = plan.steps[i];
    const stepId = step.id ?? `s${i + 1}`;

    opts.emit("agent.exec.step", {
      runId,
      stepId,
      status: "running",
      tool: step.tool,
      description: step.description,
    });

    // Look up tool in registry
    const tool = getTool(step.tool);
    if (!tool) {
      const error = `Tool not found in registry: ${step.tool}`;
      stepResults.push({ stepId, tool: step.tool, status: "error", error });
      opts.emit("agent.exec.step", { runId, stepId, status: "error", outputPreview: error });
      continue;
    }

    opts.emit("tool.start", {
      runId,
      tool: step.tool,
      toolName: tool.name,
      args: step.args,
    });

    try {
      // Resolve {{vars.*}} in args
      console.log(`[execute] Step ${stepId} resolving vars, current vars:`, Object.keys(vars));
      const resolvedArgs = resolveVars(step.args, vars);
      console.log(`[execute] Step ${stepId} resolved args:`, JSON.stringify(resolvedArgs).substring(0, 300));

      // Run tool with appropriate timeout
      const timeout = SLOW_TOOLS.has(step.tool) ? SLOW_TIMEOUT : FAST_TIMEOUT;
      const ctx = { outboxDir: opts.outboxDir, vars };

      const localExecute = () =>
        runSandboxed(() => tool.execute(resolvedArgs, ctx), {
          timeoutMs: timeout,
          label: step.tool,
        });

      const result = opts.executeTool
        ? await opts.executeTool({
            sessionId: opts.sessionId,
            step,
            args: resolvedArgs,
            timeoutMs: timeout,
            ctx,
            localExecute,
          })
        : await localExecute();

      /**
       * 错误检测逻辑
       * 
       * 某些工具不抛出异常，而是返回错误结果对象。
       * 例如 contacts.apple 可能返回：
       * { found: false, error: "无法访问 Apple 通讯录: 权限被拒绝" }
       * 
       * 检测条件：
       * 1. result.error 存在（任何值，包括空字符串）
       * 2. result.found === false（工具明确表示未找到/失败）
       * 
       * 如果检测到错误：
       * - 标记步骤为 error 状态
       * - 发送 tool.error 事件
       * - 仍然保存结果到 vars（供后续步骤检查）
       * - 继续执行后续步骤（不中断整个计划）
       */
      const hasError = result && typeof result === "object" && (
        (result as any).error !== undefined ||
        (result as any).found === false
      );

      console.log(`[execute] Step ${stepId} error check:`, {
        hasError,
        hasErrorField: !!(result as any)?.error,
        found: (result as any)?.found,
        tool: step.tool,
        resultKeys: result && typeof result === "object" ? Object.keys(result) : "not an object"
      });

      if (hasError) {
        const errorMsg = (result as any).error || "工具执行失败";
        stepResults.push({
          stepId,
          tool: step.tool,
          status: "error",
          error: errorMsg,
          output: result,
        });

        opts.emit("tool.error", { runId, tool: step.tool, toolName: tool.name, error: errorMsg });
        opts.emit("agent.exec.step", {
          runId,
          stepId,
          status: "error",
          outputPreview: errorMsg,
        });

        // Still store the result (with error) so later steps can check it
        if (step.saveAs) {
          const saveKey = step.saveAs
            .replace(/^\{\{\s*vars\.\s*/, "")
            .replace(/\s*\}\}\s*$/, "")
            .replace(/\..+$/, "");
          vars[saveKey] = result;
          console.log(`[execute] Saved error result to vars[${saveKey}]:`, JSON.stringify(result).substring(0, 200));
        }

        // Continue to next step (don't throw)
        continue;
      }

      // Store output for later steps
      if (step.saveAs) {
        // Sanitize saveAs — small models sometimes write "{{vars.foo}}" instead of "foo"
        const saveKey = step.saveAs
          .replace(/^\{\{\s*vars\.\s*/, "")
          .replace(/\s*\}\}\s*$/, "")
          .replace(/\..+$/, ""); // "{{vars.contact.name}}" → "contact"
        vars[saveKey] = result;
        console.log(`[execute] Saved result to vars[${saveKey}]:`, JSON.stringify(result).substring(0, 200));
      } else {
        console.log(`[execute] Step ${stepId} has no saveAs, result not saved`);
      }

      toolResults[stepId] = result;
      stepResults.push({ stepId, tool: step.tool, status: "ok", output: result });

      // Build a preview string for the UI
      const preview = buildPreview(result);
      opts.emit("tool.success", { runId, tool: step.tool, toolName: tool.name, result });
      opts.emit("agent.exec.step", {
        runId,
        stepId,
        status: "ok",
        outputPreview: preview,
      });
    } catch (e: any) {
      const errorMsg = e?.message || String(e);
      const isTimeout = errorMsg.includes("timeout");

      stepResults.push({
        stepId,
        tool: step.tool,
        status: isTimeout ? "timeout" : "error",
        error: errorMsg,
      });

      opts.emit("tool.error", { runId, tool: step.tool, toolName: tool.name, error: errorMsg });
      opts.emit("agent.exec.step", {
        runId,
        stepId,
        status: "error",
        outputPreview: errorMsg,
      });

      // Don't throw — record failure and continue.
    }
  }

  // ── build execution summary ────────────────────────────

  const allOk = stepResults.every((s) => s.status === "ok");
  const allFailed = stepResults.every((s) => s.status !== "ok");
  const summaryStatus = allOk ? "ok" : allFailed ? "failed" : "partial";

  const executionSummary: ExecutionSummary = {
    runId,
    planId: plan.planId,
    status: summaryStatus,
    steps: stepResults,
  };

  opts.emit("agent.exec.finished", { runId, status: summaryStatus });

  const record: RunRecord = {
    runId,
    planId: plan.planId,
    prompt: plan.prompt,
    executionSummary,
    toolResults,
  };

  saveRun(record);
  return record;
}

// ── Helper Functions (辅助函数) ──────────────────────────────────────────────

/**
 * 构建结果预览字符串（用于前端显示）
 * 
 * 根据结果类型生成简短的预览文本：
 * - 字符串：直接返回（截断到 160 字符）
 * - 文本生成结果：返回 result.text
 * - 文件保存结果：返回 "File: {path}"
 * - 消息发送结果：返回 "Sent to {name} ({platform})"
 * - 联系人查找结果：返回 "Found: {name}"
 * - 其他：JSON 字符串（截断到 160 字符）
 * 
 * @param result - 工具执行结果
 * @returns 预览字符串
 */
function buildPreview(result: any): string {
  if (!result) return "(empty)";
  if (typeof result === "string") return result.slice(0, 160);
  if (result.text) return String(result.text).slice(0, 160);
  if (result.filePath) return `File: ${result.filePath}`;
  if (result.sent) return `Sent to ${result.recipientName ?? "recipient"} (${result.platform ?? "?"})`;
  if (result.name) return `Found: ${result.name}`;
  return JSON.stringify(result).slice(0, 160);
}
