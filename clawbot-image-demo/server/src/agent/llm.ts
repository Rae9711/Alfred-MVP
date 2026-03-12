/**
 * Unified LLM Client — Routes to Claude, Qwen, Gemini, or local Ollama.
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
 *   2. If GEMINI_API_KEY is set → use Gemini (free with web search!)
 *   3. If ANTHROPIC_API_KEY is set → use Claude
 *   4. If QWEN_API_KEY is set → use Qwen
 *   5. Fall back to local Ollama (existing behavior)
 */

import Anthropic from "@anthropic-ai/sdk";

// ── provider detection ──────────────────────────────────

export type LLMProvider = "claude" | "qwen" | "gemini" | "ollama";

// Mutable settings (can be updated at runtime via API)
let currentSettings = {
  provider: (process.env.LLM_PROVIDER?.toLowerCase() || "") as LLMProvider | "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  qwenKey: process.env.QWEN_API_KEY ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  braveSearchKey: process.env.BRAVE_SEARCH_API_KEY ?? "",
  kiwiKey: process.env.KIWI_API_KEY ?? "",
};

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

/**
 * Update LLM settings at runtime (called from API endpoint)
 * Note: Empty strings from frontend don't overwrite env var values
 */
export function updateSettings(settings: {
  llmProvider?: string;
  anthropicKey?: string;
  qwenKey?: string;
  geminiKey?: string;
  ollamaUrl?: string;
  braveSearchKey?: string;
  kiwiKey?: string;
}) {
  if (settings.llmProvider) currentSettings.provider = settings.llmProvider as LLMProvider;
  // Only update API keys if frontend provides non-empty values (don't clear env var values)
  if (settings.anthropicKey) currentSettings.anthropicKey = settings.anthropicKey;
  if (settings.qwenKey) currentSettings.qwenKey = settings.qwenKey;
  if (settings.geminiKey) currentSettings.geminiKey = settings.geminiKey;
  if (settings.ollamaUrl) currentSettings.ollamaUrl = settings.ollamaUrl;
  if (settings.braveSearchKey) {
    currentSettings.braveSearchKey = settings.braveSearchKey;
    process.env.BRAVE_SEARCH_API_KEY = settings.braveSearchKey;
  }
  if (settings.kiwiKey) {
    currentSettings.kiwiKey = settings.kiwiKey;
    process.env.KIWI_API_KEY = settings.kiwiKey;
  }
  console.log(`[llm] settings updated: provider=${currentSettings.provider}, hasClaude=${!!currentSettings.anthropicKey}, hasGemini=${!!currentSettings.geminiKey}, hasBrave=${!!currentSettings.braveSearchKey}`);
}

export function getSettings() {
  return { ...currentSettings };
}

function detectProvider(): LLMProvider {
  const forced = currentSettings.provider;
  // If provider is forced, validate it has required API key
  if (forced === "gemini") {
    if (currentSettings.geminiKey) return "gemini";
    console.log("[llm] gemini requested but no API key, falling back to ollama");
    return "ollama";
  }
  if (forced === "claude") {
    if (currentSettings.anthropicKey) return "claude";
    console.log("[llm] claude requested but no API key, falling back to ollama");
    return "ollama";
  }
  if (forced === "qwen") {
    if (currentSettings.qwenKey) return "qwen";
    console.log("[llm] qwen requested but no API key, falling back to ollama");
    return "ollama";
  }
  if (forced === "ollama") return "ollama";
  
  // Auto-detect based on available keys
  if (currentSettings.geminiKey) return "gemini";
  if (currentSettings.anthropicKey) return "claude";
  if (currentSettings.qwenKey) return "qwen";
  return "ollama";
}

function getProvider(): LLMProvider {
  return detectProvider();
}

const INITIAL_PROVIDER = detectProvider();
console.log(`[llm] provider=${INITIAL_PROVIDER}`);

// ── Anthropic client (lazy init) ────────────────────────

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  const apiKey = currentSettings.anthropicKey;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude provider");
  }
  // Recreate client if key changed
  if (!anthropicClient || (anthropicClient as any)._apiKey !== apiKey) {
    anthropicClient = new Anthropic({ apiKey });
    (anthropicClient as any)._apiKey = apiKey;
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
  /** Gemini model to use for this role */
  geminiModel: string;
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
    geminiModel: "gemini-flash-latest",
    ollamaModel: PLANNER_OLLAMA_MODEL,
  },
  reporter: {
    temperature: 0.1,
    maxTokens: 4096,
    systemPrompt:
      "你是一个事实汇报助手。只报告实际发生了什么。" +
      "不要编造信息。如果数据缺失，请说明。用中文回复。",
    claudeModel: "claude-haiku-4-5",
    qwenModel: "qwen-plus",
    geminiModel: "gemini-flash-latest",
    ollamaModel: REPORTER_OLLAMA_MODEL,
  },
  styler: {
    temperature: 0.4,
    maxTokens: 4096,
    systemPrompt:
      "你是风格改写器。请按指定语气重写内容，并使用中文输出。" +
      "绝对不要新增、删除或篡改事实。",
    claudeModel: "claude-haiku-4-5",
    qwenModel: "qwen-plus",
    geminiModel: "gemini-flash-latest",
    ollamaModel: STYLER_OLLAMA_MODEL,
  },
  tool: {
    temperature: 0.2,
    maxTokens: 4096,
    systemPrompt:
      "你是一个内容生成工具。直接输出请求的内容，用中文回复。不要解释、不要评论。",
    claudeModel: "claude-haiku-4-5",
    qwenModel: "qwen-plus",
    geminiModel: "gemini-flash-latest",
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
  const apiKey = currentSettings.qwenKey;
  if (!apiKey) {
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
        Authorization: `Bearer ${apiKey}`,
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

// ── Gemini provider (free with Google Search grounding!) ──

async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  cfg: RoleConfig,
  forceJson?: boolean,
): Promise<string> {
  const apiKey = currentSettings.geminiKey;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini provider");
  }

  // Gemini API endpoint
  const model = cfg.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build request with system instruction and grounding (Google Search)
  const body: any = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: cfg.temperature,
      maxOutputTokens: cfg.maxTokens,
    },
    // Enable Google Search grounding for real-time web information
    tools: [
      {
        googleSearch: {},
      },
    ],
  };

  // For JSON output, add response schema
  if (forceJson) {
    body.generationConfig.responseMimeType = "application/json";
  }

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, "gemini");

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API failed: ${res.status} ${t}`);
  }

  const json: any = await res.json();
  
  // Extract text from Gemini response format
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const textPart = parts.find((p: any) => p.text);
  
  if (!textPart?.text) {
    throw new Error(`Gemini returned empty content: ${JSON.stringify(json).slice(0, 200)}`);
  }
  
  return String(textPart.text).trim();
}

// ── Ollama provider (existing behavior preserved) ───────

// Detect if using cloud API (OpenRouter, Together.ai, etc.)
function isCloudOllamaAPI(): boolean {
  const url = currentSettings.ollamaUrl;
  return url.includes("openrouter.ai") ||
    url.includes("together.xyz") ||
    url.includes("api.together");
}

async function callOllama(
  systemPrompt: string,
  userPrompt: string,
  cfg: RoleConfig,
  forceJson?: boolean,
): Promise<string> {
  const ollamaUrl = currentSettings.ollamaUrl;
  const isCloudAPI = isCloudOllamaAPI();
  
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
    if (ollamaUrl.includes("openrouter.ai") && OPENROUTER_API_KEY) {
      headers["Authorization"] = `Bearer ${OPENROUTER_API_KEY}`;
      headers["HTTP-Referer"] = "https://clawbot-demo.com";
      headers["X-Title"] = "Clawbot Demo";
    } else if (ollamaUrl.includes("together.xyz") && TOGETHER_API_KEY) {
      headers["Authorization"] = `Bearer ${TOGETHER_API_KEY}`;
    }
  }

  let apiUrl = `${ollamaUrl}/api/chat`;
  let requestBody: any = body;

  if (isCloudAPI) {
    apiUrl = ollamaUrl.includes("openrouter.ai")
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
  const provider = getProvider();

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

  const modelName = provider === "claude" ? effectiveCfg.claudeModel 
    : provider === "qwen" ? effectiveCfg.qwenModel 
    : provider === "gemini" ? effectiveCfg.geminiModel
    : effectiveCfg.ollamaModel;

  console.log(
    `[llm] provider=${provider} role=${role} model=${modelName} temp=${effectiveCfg.temperature}`,
  );

  let content: string;

  switch (provider) {
    case "claude":
      content = await callClaude(systemPrompt, userPrompt, effectiveCfg);
      break;
    case "qwen":
      content = await callQwen(systemPrompt, userPrompt, effectiveCfg, opts.forceJson);
      break;
    case "gemini":
      content = await callGemini(systemPrompt, userPrompt, effectiveCfg, opts.forceJson);
      break;
    case "ollama":
    default:
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
  const ollamaUrl = currentSettings.ollamaUrl;

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

  const res = await fetch(`${ollamaUrl}/api/chat`, {
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
