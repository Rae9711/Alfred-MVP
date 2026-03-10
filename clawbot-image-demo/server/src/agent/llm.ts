/**
 * Unified LLM Client — Routes to Claude, Qwen, or local Ollama.
 *
 * Three distinct roles, each with its own knobs:
 *
 *   planner  – strict JSON output, temperature ≈ 0, no personality
 *   reporter – neutral factual answer, low temperature
 *   styler   – persona rewrite only, moderate creativity
 *   tool     – content generation, low creativity
 *
 * Route logic:
 *   1. If LLM_PROVIDER is set → use that provider
 *   2. If ANTHROPIC_API_KEY is set → use Claude
 *   3. If QWEN_API_KEY is set → use Qwen
 *   4. Fall back to local Ollama (existing behavior)
 */

import Anthropic from "@anthropic-ai/sdk";

// ── provider detection ──────────────────────────────────

type LLMProvider = "claude" | "qwen" | "ollama";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

function detectProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "claude" || forced === "qwen" || forced === "ollama") {
    return forced;
  }
  if (ANTHROPIC_API_KEY) return "claude";
  if (QWEN_API_KEY) return "qwen";
  return "ollama";
}

const PROVIDER = detectProvider();
console.log(`[llm] provider=${PROVIDER}`);

// ── Anthropic client (lazy init) ────────────────────────

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is required for Claude provider");
    }
    anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

// ── per-role configs ────────────────────────────────────

export type LLMRole = "planner" | "reporter" | "styler" | "tool";

type RoleConfig = {
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  /** Claude model to use for this role */
  claudeModel: string;
  /** Qwen model to use for this role */
  qwenModel: string;
  /** Ollama model to use for this role */
  ollamaModel: string;
};

const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const PLANNER_OLLAMA_MODEL = process.env.OLLAMA_PLANNER_MODEL ?? "qwen2.5:1.5b";
const REPORTER_OLLAMA_MODEL = process.env.OLLAMA_REPORTER_MODEL ?? "qwen2.5:1.5b";
const STYLER_OLLAMA_MODEL = process.env.OLLAMA_STYLER_MODEL ?? "qwen2.5:1.5b";

const ROLE_CONFIG: Record<LLMRole, RoleConfig> = {
  planner: {
    temperature: 0,
    maxTokens: 2048,
    systemPrompt:
      "You are a planning assistant. Output ONLY valid JSON. " +
      "No prose, no markdown, no commentary. saveAs must be a plain variable name like msg or contact, never {{vars.xxx}}.",
    claudeModel: "claude-haiku-4-5",
    qwenModel: "qwen-plus",
    ollamaModel: PLANNER_OLLAMA_MODEL,
  },
  reporter: {
    temperature: 0.1,
    maxTokens: 512,
    systemPrompt:
      "你是一个事实汇报助手。只报告实际发生了什么。" +
      "不要编造信息。如果数据缺失，请说明。用中文回复。",
    claudeModel: "claude-haiku-4-5",
    qwenModel: "qwen-plus",
    ollamaModel: REPORTER_OLLAMA_MODEL,
  },
  styler: {
    temperature: 0.4,
    maxTokens: 512,
    systemPrompt:
      "你是风格改写器。请按指定语气重写内容，并使用中文输出。" +
      "绝对不要新增、删除或篡改事实。",
    claudeModel: "claude-haiku-4-5",
    qwenModel: "qwen-plus",
    ollamaModel: STYLER_OLLAMA_MODEL,
  },
  tool: {
    temperature: 0.2,
    maxTokens: 512,
    systemPrompt:
      "你是一个内容生成工具。直接输出请求的内容，用中文回复。不要解释、不要评论。",
    claudeModel: "claude-haiku-4-5",
    qwenModel: "qwen-plus",
    ollamaModel: "qwen2.5:1.5b",
  },
};

// ── retry helper ────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2_000, 5_000, 10_000];
const FETCH_TIMEOUT = 300_000;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err: any) {
      const isLast = attempt === MAX_RETRIES;
      const errMsg = err?.cause?.code ?? err?.code ?? err?.message ?? String(err);
      console.warn(
        `[llm] ${label} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${errMsg}`,
      );
      if (isLast) throw err;
      const delay = RETRY_DELAYS[attempt] ?? 5_000;
      console.log(`[llm] retrying in ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

// ── Claude provider ─────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  cfg: RoleConfig,
): Promise<string> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: cfg.claudeModel,
    max_tokens: cfg.maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    temperature: cfg.temperature,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Claude returned empty content for role`);
  }
  return textBlock.text.trim();
}

// ── Qwen provider (OpenAI-compatible API) ───────────────

async function callQwen(
  systemPrompt: string,
  userPrompt: string,
  cfg: RoleConfig,
  forceJson?: boolean,
): Promise<string> {
  if (!QWEN_API_KEY) {
    throw new Error("QWEN_API_KEY is required for Qwen provider");
  }

  const body: any = {
    model: cfg.qwenModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  };

  if (forceJson) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetchWithRetry(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify(body),
    },
    "qwen",
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Qwen API failed: ${res.status} ${t}`);
  }

  const json: any = await res.json();
  const out = json?.choices?.[0]?.message?.content;
  if (!out) {
    throw new Error(`Qwen returned empty content: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return String(out).trim();
}

// ── Ollama provider (existing behavior preserved) ───────

// Detect if using cloud API (OpenRouter, Together.ai, etc.)
const isCloudAPI =
  OLLAMA_URL.includes("openrouter.ai") ||
  OLLAMA_URL.includes("together.xyz") ||
  OLLAMA_URL.includes("api.together");

async function callOllama(
  systemPrompt: string,
  userPrompt: string,
  cfg: RoleConfig,
  forceJson?: boolean,
): Promise<string> {
  const body: any = {
    model: cfg.ollamaModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
    options: {
      temperature: cfg.temperature,
      num_predict: cfg.maxTokens,
    },
  };

  if (forceJson) body.format = "json";

  // Build headers (add auth for cloud APIs)
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isCloudAPI) {
    if (OLLAMA_URL.includes("openrouter.ai") && OPENROUTER_API_KEY) {
      headers["Authorization"] = `Bearer ${OPENROUTER_API_KEY}`;
      headers["HTTP-Referer"] = "https://clawbot-demo.com";
      headers["X-Title"] = "Clawbot Demo";
    } else if (OLLAMA_URL.includes("together.xyz") && TOGETHER_API_KEY) {
      headers["Authorization"] = `Bearer ${TOGETHER_API_KEY}`;
    }
  }

  let apiUrl = `${OLLAMA_URL}/api/chat`;
  let requestBody: any = body;

  if (isCloudAPI) {
    apiUrl = OLLAMA_URL.includes("openrouter.ai")
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.together.xyz/v1/chat/completions";

    const modelMap: Record<string, string> = {
      "qwen2.5:1.5b": "qwen/qwen-2-1.5b-instruct:free",
      "qwen2.5:7b": "qwen/qwen-2-7b-instruct:free",
    };
    const cloudModel = modelMap[cfg.ollamaModel] ?? cfg.ollamaModel;

    requestBody = {
      model: cloudModel,
      messages: body.messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
    };
    if (forceJson) {
      requestBody.response_format = { type: "json_object" };
    }
  }

  const res = await fetchWithRetry(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  }, "ollama");

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama chat failed: ${res.status} ${t}`);
  }

  const json: any = await res.json();

  let out: string;
  if (isCloudAPI) {
    out = json?.choices?.[0]?.message?.content;
  } else {
    out = json?.message?.content;
  }

  if (!out) {
    throw new Error(`Ollama returned empty content: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return String(out).trim();
}

// ── unified public API ──────────────────────────────────

/**
 * Unified chat completion — routes to the active LLM provider.
 */
export async function chatCompletion(opts: {
  messages: Array<{ role: string; content: string }>;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  role?: LLMRole;
  forceJson?: boolean;
}): Promise<{ content: string }> {
  const role = opts.role ?? "reporter";
  const cfg = ROLE_CONFIG[role];

  const systemPrompt = opts.system ?? cfg.systemPrompt;
  const userPrompt = opts.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  const effectiveCfg: RoleConfig = {
    ...cfg,
    temperature: opts.temperature ?? cfg.temperature,
    maxTokens: opts.maxTokens ?? cfg.maxTokens,
  };

  console.log(
    `[llm] provider=${PROVIDER} role=${role} model=${PROVIDER === "claude" ? effectiveCfg.claudeModel : PROVIDER === "qwen" ? effectiveCfg.qwenModel : effectiveCfg.ollamaModel} temp=${effectiveCfg.temperature}`,
  );

  let content: string;

  switch (PROVIDER) {
    case "claude":
      content = await callClaude(systemPrompt, userPrompt, effectiveCfg);
      break;
    case "qwen":
      content = await callQwen(systemPrompt, userPrompt, effectiveCfg, opts.forceJson);
      break;
    case "ollama":
      content = await callOllama(systemPrompt, userPrompt, effectiveCfg, opts.forceJson);
      break;
  }

  return { content };
}

// ── backwards-compatible textComplete ───────────────────

/**
 * Drop-in replacement for the old ollama.ts `textComplete()`.
 * Tools and other modules that import this don't need to change.
 */
export async function textComplete(args: {
  prompt: string;
  role?: LLMRole;
  forceJson?: boolean;
}): Promise<string> {
  const prompt = (args.prompt ?? "").trim();
  if (!prompt) throw new Error("textComplete requires a non-empty prompt");

  const { content } = await chatCompletion({
    messages: [{ role: "user", content: prompt }],
    role: args.role ?? "reporter",
    forceJson: args.forceJson,
  });

  return content;
}

// ── legacy vision (kept for backwards compat) ───────────

function urlToLocalUploadPath(imageUrl: string) {
  const u = new URL(imageUrl);
  const pathname = u.pathname;
  if (!pathname.startsWith("/uploads/")) throw new Error("Unexpected imageUrl path");
  const file = pathname.replace("/uploads/", "");
  return new URL(`../uploads/${file}`, import.meta.url).pathname;
}

async function fileToBase64(filePath: string) {
  const fs = await import("fs");
  const buf = fs.readFileSync(filePath);
  return buf.toString("base64");
}

export async function visionSummarize(imageUrl: string): Promise<string> {
  // Vision only works with Ollama for now (multimodal local model)
  const localPath = urlToLocalUploadPath(imageUrl);
  const b64 = await fileToBase64(localPath);

  const prompt =
    "You are a helpful assistant. Look at the image and write a concise summary (3-6 bullet points) " +
    "and one clear action item. Keep it short and factual.";

  const ollamaModel = process.env.OLLAMA_PLANNER_MODEL ?? "qwen2.5:1.5b";

  const body = {
    model: ollamaModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: b64 },
          { type: "text", text: prompt },
        ],
      },
    ],
    stream: false,
  };

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama vision failed: ${res.status} ${t}`);
  }

  const json: any = await res.json();
  const out = json?.message?.content;
  if (!out) throw new Error("Ollama returned empty content (vision)");
  return String(out).trim();
}
