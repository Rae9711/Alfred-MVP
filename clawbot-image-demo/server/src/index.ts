/**
 * Main Server Entry Point (服务器主入口)
 * 
 * 这是整个后端服务的入口文件，负责：
 * 1. Express HTTP 服务器设置
 * 2. WebSocket 服务器设置
 * 3. 消息路由和处理
 * 4. 静态文件服务（生产环境）
 * 
 * ## 服务器架构
 * 
 * - **HTTP**: Express 服务器，提供 REST API
 * - **WebSocket**: 实时双向通信，用于 Agent 操作
 * - **静态文件**: 生产环境 serve 前端文件
 * 
 * ## 启动流程
 * 
 * 1. 导入工具注册模块（自动注册所有工具）
 * 2. 创建 Express 应用
 * 3. 设置中间件（CORS, JSON）
 * 4. 设置路由（/health）
 * 5. 设置静态文件服务（生产环境）
 * 6. 创建 WebSocket 服务器
 * 7. 监听端口（默认 8080）
 * 
 * ## WebSocket 消息类型
 * 
 * ### 客户端 → 服务器
 * 
 * - `session.setPersona`: 设置 AI 人格
 * - `session.setPrompt`: 设置提示词
 * - `agent.plan`: 生成计划
 * - `agent.execute`: 执行计划
 * - `agent.render`: 重新渲染结果（不同风格）
 * 
 * ### 服务器 → 客户端
 * 
 * - `gateway.ready`: 连接就绪
 * - `agent.plan.proposed`: 计划生成完成
 * - `agent.plan.error`: 计划生成失败
 * - `agent.exec.started`: 执行开始
 * - `agent.exec.step`: 步骤状态更新
 * - `agent.exec.finished`: 执行完成
 * - `tool.start`: 工具开始执行
 * - `tool.success`: 工具执行成功
 * - `tool.error`: 工具执行失败
 * - `agent.rendered`: 结果渲染完成
 * 
 * ## 执行流程
 * 
 * 1. **Plan Generation** (agent.plan):
 *    - 调用 `createPlan()` 生成计划
 *    - 发送 `agent.plan.proposed` 事件
 * 
 * 2. **Execution** (agent.execute):
 *    - 调用 `executePlan()` 执行计划
 *    - 发送执行事件（tool.start, tool.success, etc.）
 *    - 调用 `renderFinal()` 生成最终答案
 *    - 发送 `agent.rendered` 事件
 * 
 * 3. **Re-render** (agent.render):
 *    - 使用不同的 persona 重新渲染结果
 *    - 发送 `agent.rendered` 事件
 * 
 * ## 错误处理
 * 
 * - WebSocket 消息解析失败：返回 "Bad JSON" 错误
 * - 未知方法：返回 "Unknown method" 错误
 * - 执行错误：发送 `agent.plan.error` 事件
 * - 渲染失败：发送降级消息（包含执行摘要）
 * 
 * ## 环境变量
 * 
 * - `PORT`: 服务器端口（默认 8080）
 * - `NODE_ENV`: 环境模式（development/production）
 * - `OLLAMA_URL`: Ollama API 地址
 * - `OLLAMA_MODEL`: 默认模型
 */
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import { WebSocketServer } from "ws";
import { runSandboxed } from "./sandbox/sandboxRunner.js";
import {
  bindConnector,
  getConnectorId,
  getSession,
  setPersona,
  setPrompt,
  setUserId,
  setActionMode,
  getActionMode,
  setClarificationContext,
  getClarificationContext,
  clearClarificationContext,
} from "./sessionStore.js";
import { getSupabase } from "./db/supabase.js";
import { createPlan } from "./agent/plan.js";
import { executePlan } from "./agent/execute.js";
import { renderFinal } from "./agent/render.js";
import { savePlan } from "./planStore.js";
import { updateSettings, getSettings, chatCompletion } from "./agent/llm.js";
import {
  getConnectedConnectorIds,
  getConnectorIdBySocket,
  hasConnector,
  invokeConnectorTool,
  registerConnector,
  resolveConnectorResult,
  unregisterConnectorBySocket,
} from "./connectorHub.js";

/**
 * 导入工具注册模块
 * 
 * 这个导入会执行所有工具的 registerTool() 调用，
 * 将所有工具注册到全局工具注册表中。
 * 
 * 工具注册顺序：
 * 1. text.generate
 * 2. image.generate
 * 3. contacts.apple
 * 4. platform.send
 * 5. sms.send
 * 6. imessage.send
 * 7. file.save
 */
import "./agent/tools/index.js";

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Settings API endpoints ──────────────────────────────

// Get current settings (masks sensitive keys)
app.get("/api/settings", (_req, res) => {
  const settings = getSettings();
  res.json({
    llmProvider: settings.provider || "auto",
    hasAnthropicKey: !!settings.anthropicKey,
    hasQwenKey: !!settings.qwenKey,
    hasGeminiKey: !!settings.geminiKey,
    hasBraveSearchKey: !!settings.braveSearchKey,
    hasKiwiKey: !!settings.kiwiKey,
    ollamaUrl: settings.ollamaUrl,
  });
});

// Update settings
app.post("/api/settings", (req, res) => {
  try {
    const body = req.body;
    updateSettings({
      llmProvider: body.llmProvider,
      anthropicKey: body.anthropicKey,
      qwenKey: body.qwenKey,
      geminiKey: body.geminiKey,
      ollamaUrl: body.ollamaUrl,
      braveSearchKey: body.braveSearchKey,
      kiwiKey: body.kiwiKey,
    });
    console.log("[settings] updated via API");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Test LLM connection
app.post("/api/settings/test", async (req, res) => {
  try {
    const body = req.body;
    // Temporarily update settings for testing
    updateSettings({
      llmProvider: body.llmProvider,
      anthropicKey: body.anthropicKey,
      qwenKey: body.qwenKey,
      geminiKey: body.geminiKey,
      ollamaUrl: body.ollamaUrl,
    });

    // Try a simple completion
    const result = await chatCompletion({
      messages: [{ role: "user", content: "Say 'OK' in Chinese." }],
      role: "reporter",
      maxTokens: 100,
    });

    res.json({ 
      ok: true, 
      provider: body.llmProvider || "auto",
      response: result.content.slice(0, 50),
    });
  } catch (e: any) {
    res.json({ 
      ok: false, 
      error: e.message || "Connection failed",
    });
  }
});

// File upload endpoint (for PDF processing)
const uploadsDir = path.resolve("src/uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"));
    }
  },
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  // Rename to preserve .pdf extension
  const newPath = req.file.path + ".pdf";
  fs.renameSync(req.file.path, newPath);
  const fileId = path.basename(newPath);
  console.log(`[upload] file saved: ${fileId}`);
  res.json({ ok: true, fileId });
});

// Delete uploaded file endpoint
app.delete("/upload/:fileId", (req, res) => {
  const { fileId } = req.params;
  // Validate fileId to prevent directory traversal
  if (!fileId || fileId.includes("/") || fileId.includes("..")) {
    res.status(400).json({ error: "Invalid fileId" });
    return;
  }
  const filePath = path.join(uploadsDir, fileId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[upload] file deleted: ${fileId}`);
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: "File not found" });
    }
  } catch (e: any) {
    console.error(`[upload] delete failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ── WeCom Kefu webhook (微信客服回调) ──

import { getTool } from "./agent/tools/registry.js";
import {
  getAccessToken as getWeComToken,
  sendWeComMessage,
  registerExternalUser,
  isWeComConfigured,
  WECOM_KF_ID,
} from "./agent/tools/wechat.send.js";
import crypto from "crypto";

const WECOM_CALLBACK_TOKEN = (process.env.WECOM_CALLBACK_TOKEN ?? "").trim();
const WECOM_CALLBACK_AES_KEY = (process.env.WECOM_CALLBACK_AES_KEY ?? "").trim();

// WeCom callback URL verification (GET)
app.get("/webhook/wechat", (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query as Record<string, string>;

  if (!WECOM_CALLBACK_TOKEN || !WECOM_CALLBACK_AES_KEY || !echostr) {
    res.status(400).send("WeCom callback not configured");
    return;
  }

  // Verify signature
  const sorted = [WECOM_CALLBACK_TOKEN, timestamp, nonce, echostr].sort().join("");
  const signature = crypto.createHash("sha1").update(sorted).digest("hex");

  if (signature !== msg_signature) {
    res.status(403).send("Invalid signature");
    return;
  }

  // Decrypt echostr
  try {
    const decrypted = decryptWeComMsg(echostr);
    res.send(decrypted);
  } catch (e: any) {
    console.error("[webhook/wechat] decrypt echostr failed:", e?.message);
    res.status(500).send("Decrypt failed");
  }
});

// WeCom callback event notification (POST)
// This is a lightweight notification — we then call sync_msg to get actual messages
app.post("/webhook/wechat", express.text({ type: "*/*" }), async (req, res) => {
  // Respond immediately (WeCom requires response within 5 seconds)
  res.send("success");

  if (!isWeComConfigured) return;

  try {
    const { msg_signature, timestamp, nonce } = req.query as Record<string, string>;

    // Parse the XML body to extract Token and OpenKfId
    const body = typeof req.body === "string" ? req.body : "";
    const tokenMatch = body.match(/<Token><!\[CDATA\[(.*?)\]\]><\/Token>/);
    const kfIdMatch = body.match(/<OpenKfId><!\[CDATA\[(.*?)\]\]><\/OpenKfId>/);
    const callbackToken = tokenMatch?.[1] ?? "";

    // Pull messages using sync_msg
    await syncAndReplyMessages(callbackToken);
  } catch (e: any) {
    console.error("[webhook/wechat] callback error:", e?.message ?? e);
  }
});

// Cursor for message pagination (persisted in memory)
let syncCursor = "";

async function syncAndReplyMessages(token: string) {
  const accessToken = await getWeComToken();
  const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`;

  const syncRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cursor: syncCursor,
      token,
      limit: 100,
      open_kfid: WECOM_KF_ID,
    }),
  });

  const data: any = await syncRes.json();
  if (data.errcode !== 0) {
    console.error("[webhook/wechat] sync_msg error:", data.errcode, data.errmsg);
    return;
  }

  if (data.next_cursor) {
    syncCursor = data.next_cursor;
  }

  const messages: any[] = data.msg_list ?? [];

  for (const msg of messages) {
    // Only handle messages FROM the customer (origin=3) that are text
    if (msg.origin !== 3) continue;

    const externalUserId = msg.external_userid ?? "";

    // Handle enter_session event — send welcome message
    if (msg.msgtype === "event" && msg.event?.event_type === "enter_session") {
      const welcomeCode = msg.event.welcome_code;
      if (welcomeCode) {
        await sendWelcomeMessage(welcomeCode);
      }
      // Fetch user info to register their name
      await fetchAndRegisterUser(externalUserId);
      continue;
    }

    // Handle text messages
    if (msg.msgtype !== "text") continue;

    const content = (msg.text?.content ?? "").trim();
    if (!content || !externalUserId) continue;

    // Fetch user info if not already known
    await fetchAndRegisterUser(externalUserId);

    console.log(`[webhook/wechat] message from ${externalUserId}: "${content.slice(0, 60)}..."`);

    // Auto-reply flow
    const sessionId = `wechat-${externalUserId}`;
    const session = getSession(sessionId);

    try {
      const plan = await runSandboxed(
        () =>
          createPlan({
            sessionId,
            prompt: content,
            intent: "wechat-auto-reply",
            platform: "wechat",
          }),
        { timeoutMs: 600_000, label: "wechat-webhook-plan" },
      );

      // If plan needs clarification, send the question back
      const clarifyStep = plan.steps.find((s: any) => s.tool === "clarify");
      if (clarifyStep) {
        const question = clarifyStep.args?.question ?? "请提供更多细节";
        await sendWeComMessage(externalUserId, question);
        continue;
      }

      // Execute the plan
      const noopEmit = () => {};
      const run = await executePlan({
        sessionId,
        planId: plan.planId,
        approved: true,
        emit: noopEmit,
        outboxDir,
        executeTool: async ({ step, args, localExecute }) => localExecute(),
      });

      // Render and send reply
      const rendered = await renderFinal({ runId: run.runId, persona: session.persona });
      await sendWeComMessage(externalUserId, rendered.message);
    } catch (e: any) {
      console.error(`[webhook/wechat] auto-reply error for ${externalUserId}:`, e?.message);
      await sendWeComMessage(externalUserId, "抱歉，处理您的请求时出现了问题，请稍后再试。").catch(() => {});
    }
  }
}

async function sendWelcomeMessage(welcomeCode: string) {
  try {
    const accessToken = await getWeComToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg_on_event?access_token=${encodeURIComponent(accessToken)}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: welcomeCode,
        msgtype: "text",
        text: { content: "你好！我是阿福 (Alfred)，你的AI助手。有什么可以帮你的吗？" },
      }),
    });
  } catch (e: any) {
    console.error("[webhook/wechat] welcome message failed:", e?.message);
  }
}

async function fetchAndRegisterUser(externalUserId: string) {
  // Skip if already known
  const { externalUserMap } = await import("./agent/tools/wechat.send.js");
  if (externalUserMap.has(externalUserId)) return;

  try {
    const accessToken = await getWeComToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/customer/batchget?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        external_userid_list: [externalUserId],
      }),
    });
    const data: any = await res.json();
    const customers = data.customer_list ?? [];
    for (const c of customers) {
      const name = c.nickname ?? c.name ?? externalUserId;
      registerExternalUser(c.external_userid, name);
      console.log(`[webhook/wechat] registered user: ${name} (${c.external_userid})`);
    }
  } catch {
    // Non-critical — we can still reply using externalUserId directly
  }
}

// WeCom AES decryption helper
function decryptWeComMsg(encrypted: string): string {
  try {
    const aesKey = Buffer.from(WECOM_CALLBACK_AES_KEY + "=", "base64");
    const iv = aesKey.subarray(0, 16);
    const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]);

    // Remove PKCS#7 padding
    const pad = decrypted[decrypted.length - 1];
    decrypted = decrypted.subarray(0, decrypted.length - pad);

    // Format: random(16) + msg_len(4, big-endian) + msg + corpid
    const msgLen = decrypted.readUInt32BE(16);
    const msg = decrypted.subarray(20, 20 + msgLen).toString("utf-8");

    return msg;
  } catch (error) {
    console.error("[decryptWeComMsg] Decryption failed:", error);
    throw new Error("Decryption failed");
  }
}

// Keep outbox (still useful even for text-only "send to team" sandbox artifacts)
const outboxDir = path.resolve("src/outbox");
fs.mkdirSync(outboxDir, { recursive: true });

// Serve frontend static files in production
const isProduction = process.env.NODE_ENV === "production";
if (isProduction) {
  // Try multiple paths: Docker build path, then local dev path
  const webDistPaths = [
    path.resolve("./web-dist"),  // Docker build (copied from frontend-builder)
    path.resolve("../web/dist"), // Local development
  ];
  
  for (const webDist of webDistPaths) {
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(webDist, "index.html"));
      });
      console.log(`Serving frontend from: ${webDist}`);
      break;
    }
  }
}

const PORT = process.env.PORT ?? 8080;
const server = app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
  console.log("Ollama endpoint:", process.env.OLLAMA_URL ?? "http://127.0.0.1:11434");
  console.log("Ollama model:", process.env.OLLAMA_MODEL ?? "qwen2.5:7b");
});

type WSMsg =
  | { id: string; method: "session.setPersona"; params: { sessionId: string; persona: string } }
  | { id: string; method: "session.setPrompt"; params: { sessionId: string; prompt: string } }
  | { id: string; method: "session.setActionMode"; params: { sessionId: string; mode: string } }
  | { id: string; method: "session.bindConnector"; params: { sessionId: string; connectorId: string } }
  | { id: string; method: "agent.plan"; params: { sessionId: string; intent: string; prompt?: string; teamTarget?: string; platform?: string } }
  | { id: string; method: "agent.execute"; params: { sessionId: string; planId: string; approved: boolean } }
  | { id: string; method: "agent.render"; params: { sessionId: string; runId: string; persona: string } }
  | { id: string; method: "agent.run_action"; params: { sessionId: string; tool: string; args?: Record<string, any>; label?: string } }
  | { id: string; method: "agent.clarify.response"; params: { sessionId: string; answer: string } }
  | { id: string; method: "connector.register"; params: { connectorId: string; token?: string } }
  | { id: string; method: "connector.result"; params: { requestId: string; ok: boolean; result?: any; error?: string } };

function sendJSON(ws: any, obj: any) {
  ws.send(JSON.stringify(obj));
}

const wss = new WebSocketServer({ server });

// Track web-client WebSocket connections by sessionId so we can push connector status events.
const sessionWebSockets = new Map<string, any>();

// wechat.send now calls WeChatPadPro directly — no connector needed
// browser.* tools use Playwright on the connector
const CONNECTOR_TOOLS = new Set(["contacts.apple", "imessage.send", "app.open", "browser.search_flights", "browser.open_page", "browser.search_web", "browser.read_gmail", "browser.extract_page", "browser.click_link_by_text", "browser.fill_input", "browser.compose_gmail_draft", "browser.manage_calendar", "browser.submit_chatgpt_prompt"]);
const CONNECTOR_TOKEN = process.env.CONNECTOR_TOKEN?.trim();
const REQUIRE_CONNECTOR_FOR_APPLE = process.env.REQUIRE_CONNECTOR_FOR_APPLE !== "false";

wss.on("connection", async (ws, req) => {
  // Extract JWT from ?token= query param and verify with Supabase
  let verifiedUserId: string | undefined;
  const sb = getSupabase();
  if (sb && req.url) {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (token) {
        const { data, error } = await sb.auth.getUser(token);
        if (!error && data?.user) {
          verifiedUserId = data.user.id;
          console.log("[auth] verified user:", verifiedUserId);
        } else {
          console.warn("[auth] token verification failed:", error?.message);
        }
      }
    } catch (e: any) {
      console.warn("[auth] error parsing token:", e?.message);
    }
  }

  ws.on("message", async (raw) => {
    let msg: WSMsg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendJSON(ws, { type: "error", error: "Bad JSON" });
      return;
          console.log(`[ws] New websocket connection from ${req.socket.remoteAddress}`);
    }

    const msgId = msg.id;

    try {
      if (msg.method === "session.setPersona") {
        setPersona(msg.params.sessionId, msg.params.persona);
        if (verifiedUserId) setUserId(msg.params.sessionId, verifiedUserId);
        sendJSON(ws, { id: msg.id, ok: true });
        return;
      }

      if (msg.method === "session.setPrompt") {
        setPrompt(msg.params.sessionId, msg.params.prompt ?? "");
        sendJSON(ws, { id: msg.id, ok: true });
        return;
      }

      if (msg.method === "session.setActionMode") {
        setActionMode(msg.params.sessionId, msg.params.mode as any);
        sendJSON(ws, { id: msg.id, ok: true });
        return;
      }


      if (msg.method === "session.bindConnector") {
        const sessionId = msg.params.sessionId;
        const connectorId = (msg.params.connectorId ?? "").trim();
        console.log(`[bindConnector] sessionId=${sessionId} binding to connectorId=${connectorId}`);
        if (!connectorId) throw new Error("connectorId is required");

        bindConnector(sessionId, connectorId);
        // Track this web-client socket so we can push status events later
        sessionWebSockets.set(sessionId, ws);
        const connected = hasConnector(connectorId);
        console.log(`[bindConnector] sessionId=${sessionId} bound to connectorId=${connectorId} (connected=${connected})`);
        console.log(`[bindConnector] currently registered connectors: ${getConnectedConnectorIds().join(", ")}`);
        sendJSON(ws, {
          id: msg.id,
          ok: true,
          result: {
            sessionId,
            connectorId,
            connected,
          },
        });
        return;
      }

      if (msg.method === "connector.register") {
        const connectorId = (msg.params.connectorId ?? "").trim();
          console.log(`[connector] before register — connected connectors: ${getConnectedConnectorIds().join(", ")}`);
        if (!connectorId) throw new Error("connectorId is required");

        if (CONNECTOR_TOKEN && msg.params.token !== CONNECTOR_TOKEN) {
          console.warn(`[connector] register rejected (invalid token): ${connectorId}`);
          sendJSON(ws, { id: msg.id, ok: false, error: "Invalid connector token" });
          return;
        }

        registerConnector(connectorId, ws as any);
        console.log(`[connector] register accepted: ${connectorId}. connected now: ${getConnectedConnectorIds().join(", ")}`);
        sendJSON(ws, {
          id: msg.id,
          ok: true,
          result: {
            connectorId,
            connectedConnectors: getConnectedConnectorIds(),
          },
        });

        // Push connector.status to all web sessions bound to this connector
        for (const [sessionId, clientWs] of sessionWebSockets.entries()) {
          if (getConnectorId(sessionId) === connectorId) {
            try {
              console.log(`[connector.register] notifying bound web session: sessionId=${sessionId} connectorId=${connectorId}`);
              sendJSON(clientWs, {
                type: "event",
                event: "connector.status",
                data: { connectorId, connected: true },
              });
            } catch { /* socket may be closed */ }
          }
        }
        return;
      }

      if (msg.method === "connector.result") {
        resolveConnectorResult(msg.params);
        sendJSON(ws, { id: msg.id, ok: true });
        return;
      }

      // ── Call A: Planner ──────────────────────────────
      if (msg.method === "agent.plan") {
        const session = getSession(msg.params.sessionId);
        const prompt = (msg.params.prompt ?? session.prompt ?? "").trim();
        if (!prompt) throw new Error("Prompt is required");

        const plan = await runSandboxed(
          () =>
            createPlan({
              sessionId: msg.params.sessionId,
              prompt,
              intent: msg.params.intent ?? "unspecified",
              platform: msg.params.platform ?? "wecom",
            }),
          { timeoutMs: 600_000, label: "createPlan" },
        );

        if (plan.steps.some((s: any) => s.tool === "browser.search_flights")) {
          console.log("[agent.plan] planner selected browser.search_flights", {
            requiredPermissions: plan.requiredPermissions,
            sessionId: msg.params.sessionId,
          });
        }

        // Check if the plan contains a clarify step — if so, emit clarification event
        const clarifyStep = plan.steps.find((s: any) => s.tool === "clarify");
        if (clarifyStep) {
          const question = clarifyStep.args?.question ?? "请提供更多细节";
          // Store which variable the clarification should be saved as (e.g. origin/recipient)
          const saveAs = clarifyStep.args?.saveAs ?? clarifyStep.id;
          setClarificationContext(msg.params.sessionId, { originalPrompt: prompt, saveAs, clarifyStepId: clarifyStep.id });
          sendJSON(ws, {
            type: "event",
            event: "agent.clarify",
            data: { question, planId: plan.planId },
          });
          sendJSON(ws, { id: msg.id, ok: true, result: { planId: plan.planId, needsClarification: true } });
          console.log("[agent.plan] needs clarification:", question);
          return;
        }

        sendJSON(ws, { type: "event", event: "agent.plan.proposed", data: plan });

        // In immediate mode, auto-execute without waiting for user approval
        const actionMode = getActionMode(msg.params.sessionId);
        if (actionMode === "immediate") {
          sendJSON(ws, { id: msg.id, ok: true, result: { planId: plan.planId, autoExecute: true } });
          console.log("[agent.plan] immediate mode — auto-executing");
          // Trigger execution inline
          const session = getSession(msg.params.sessionId);
          const emit = (event: string, data: any) => {
            sendJSON(ws, { type: "event", event, data });
          };
          const run = await executePlan({
            sessionId: msg.params.sessionId,
            planId: plan.planId,
            approved: true,
            emit,
            outboxDir,
            executeTool: async ({ sessionId, step, args, timeoutMs, localExecute }) => {
              const connId = getConnectorId(sessionId);
              if (!CONNECTOR_TOOLS.has(step.tool)) return localExecute();
              if (!connId) {
                if (!REQUIRE_CONNECTOR_FOR_APPLE) return localExecute();
                return { error: "当前会话未绑定本机 Connector。" };
              }
              if (!hasConnector(connId)) {
                return { error: `未连接本地 Connector（${connId}）。` };
              }
              try {
                if (step.tool === "browser.search_flights") {
                  console.log("[execute] connector received browser.search_flights dispatch", {
                    connectorId: connId,
                    sessionId,
                  });
                }
                if (step.tool === "browser.open_page") {
                  console.log("[execute] connector executing browser.open_page", {
                    connectorId: connId,
                    url: args?.url,
                  });
                }
                if (step.tool === "browser.search_web") {
                  console.log("[execute] connector executing browser.search_web", {
                    connectorId: connId,
                    query: args?.query,
                  });
                }
                if (step.tool === "browser.extract_page") {
                  console.log("[execute] connector executing browser.extract_page", {
                    connectorId: connId,
                    mode: args?.mode ?? "current_page",
                  });
                }
                if (step.tool === "browser.click_link_by_text") {
                  console.log("[execute] connector executing browser.click_link_by_text", {
                    connectorId: connId,
                    ordinal: args?.ordinal ?? 1,
                  });
                }
                const connectorResult = await invokeConnectorTool({ connectorId: connId, tool: step.tool, args, timeoutMs: timeoutMs + 15_000 });
                if (step.tool === "browser.search_flights") {
                  const count = Array.isArray(connectorResult?.flights) ? connectorResult.flights.length : 0;
                  console.log(`[execute] browser.search_flights returned ${count} flights`);
                }
                if (step.tool === "browser.open_page") {
                  console.log(`[execute] browser.open_page returned title="${connectorResult?.title}" finalUrl="${connectorResult?.finalUrl}"`);
                }
                if (step.tool === "browser.search_web") {
                  const count = Array.isArray(connectorResult?.results) ? connectorResult.results.length : 0;
                  console.log(`[execute] browser.search_web returned ${count} results for query="${connectorResult?.query}"`);
                }
                if (step.tool === "browser.extract_page") {
                  const len = typeof connectorResult?.content === "string" ? connectorResult.content.length : 0;
                  console.log(`[execute] browser.extract_page: url="${connectorResult?.url}" title="${connectorResult?.title}" contentLen=${len} truncated=${connectorResult?.truncated}`);
                }
                return connectorResult;
              } catch (e: any) {
                return { error: `本地 Connector 执行失败: ${e?.message || String(e)}` };
              }
            },
          });
          try {
            const rendered = await renderFinal({ runId: run.runId, persona: session.persona });
            sendJSON(ws, { type: "event", event: "agent.rendered", data: rendered });
          } catch (renderErr: any) {
            console.error("[render] ERROR:", renderErr?.message ?? renderErr);
            sendJSON(ws, {
              type: "event",
              event: "agent.rendered",
              data: {
                runId: run.runId,
                persona: session.persona,
                message: `执行已完成（${run.executionSummary.status}），但生成回复时出错。`,
              },
            });
          }
          return;
        }

        sendJSON(ws, { id: msg.id, ok: true, result: { planId: plan.planId } });
        console.log("[agent.plan] done", msg.params.sessionId, "prompt len", prompt.length);
        return;
      }

      // ── Deterministic execution → Reporter → Styler ──
      if (msg.method === "agent.execute") {
        const session = getSession(msg.params.sessionId);

        const emit = (event: string, data: any) => {
          sendJSON(ws, { type: "event", event, data });
        };

        // Execution: dispatch to tools from registry
        const run = await executePlan({
          sessionId: msg.params.sessionId,
          planId: msg.params.planId,
          approved: msg.params.approved,
          emit,
          outboxDir,
          executeTool: async ({ sessionId, step, args, timeoutMs, localExecute }) => {
            const connectorId = getConnectorId(sessionId);

            if (!CONNECTOR_TOOLS.has(step.tool)) {
              return localExecute();
            }

            if (!connectorId) {
              if (!REQUIRE_CONNECTOR_FOR_APPLE) {
                return localExecute();
              }
              return {
                error: "当前会话未绑定本机 Connector。请先在页面中绑定 Connector ID 后再执行 Apple 通讯录/iMessage 操作。",
              };
            }

            if (!hasConnector(connectorId)) {
              return {
                error: `未连接本地 Connector（${connectorId}）。请在你的 Mac 上启动 Connector 后重试。`,
              };
            }

            try {
              if (step.tool === "browser.search_flights") {
                console.log("[execute] connector received browser.search_flights dispatch", {
                  connectorId,
                  sessionId,
                });
              }
              if (step.tool === "browser.open_page") {
                console.log("[execute] connector executing browser.open_page", {
                  connectorId,
                  url: args?.url,
                });
              }
              if (step.tool === "browser.search_web") {
                console.log("[execute] connector executing browser.search_web", {
                  connectorId,
                  query: args?.query,
                });
              }
              if (step.tool === "browser.extract_page") {
                console.log("[execute] connector executing browser.extract_page", {
                  connectorId,
                  mode: args?.mode ?? "current_page",
                });
              }
              if (step.tool === "browser.click_link_by_text") {
                console.log("[execute] connector executing browser.click_link_by_text", {
                  connectorId,
                  ordinal: args?.ordinal ?? 1,
                });
              }
              const connectorResult = await invokeConnectorTool({
                connectorId,
                tool: step.tool,
                args,
                timeoutMs: timeoutMs + 15_000,
              });
              if (step.tool === "browser.search_flights") {
                const count = Array.isArray(connectorResult?.flights) ? connectorResult.flights.length : 0;
                console.log(`[execute] browser.search_flights returned ${count} flights`);
              }
              if (step.tool === "browser.open_page") {
                console.log(`[execute] browser.open_page returned title="${connectorResult?.title}" finalUrl="${connectorResult?.finalUrl}"`);
              }
              if (step.tool === "browser.search_web") {
                const count = Array.isArray(connectorResult?.results) ? connectorResult.results.length : 0;
                console.log(`[execute] browser.search_web returned ${count} results for query="${connectorResult?.query}"`);
              }
              if (step.tool === "browser.extract_page") {
                const len = typeof connectorResult?.content === "string" ? connectorResult.content.length : 0;
                console.log(`[execute] browser.extract_page: url="${connectorResult?.url}" title="${connectorResult?.title}" contentLen=${len} truncated=${connectorResult?.truncated}`);
              }
              return connectorResult;
            } catch (e: any) {
              return {
                error: `本地 Connector 执行失败: ${e?.message || String(e)}`,
              };
            }
          },
        });

        // Reporter + optional Styler — the only post-execution LLM calls.
        // If rendering fails, still return the run result (execution succeeded).
        try {
          const rendered = await renderFinal({
            runId: run.runId,
            persona: session.persona,
          });
          sendJSON(ws, { type: "event", event: "agent.rendered", data: rendered });
        } catch (renderErr: any) {
          console.error("[render] ERROR:", renderErr?.message ?? renderErr);
          // Fallback: send execution summary as the rendered message
          sendJSON(ws, {
            type: "event",
            event: "agent.rendered",
            data: {
              runId: run.runId,
              persona: session.persona,
              message: `执行已完成（${run.executionSummary.status}），但生成回复时出错。\n\n` +
                `错误: ${renderErr?.message ?? "未知错误"}\n\n` +
                `执行摘要:\n${run.executionSummary.steps.map(s => `• ${s.tool}: ${s.status}`).join("\n")}`,
            },
          });
        }

        sendJSON(ws, { id: msg.id, ok: true, result: { runId: run.runId } });
        return;
      }

      // ── Clarification response ───────────────────────
      if (msg.method === "agent.clarify.response") {
        const ctx = getClarificationContext(msg.params.sessionId);
        if (!ctx) {
          sendJSON(ws, { id: msg.id, ok: false, error: "No clarification context" });
          return;
        }

        // Re-plan with the user's clarification appended
        const clarifiedPrompt = `${ctx.originalPrompt}\n\n用户补充说明: ${msg.params.answer}`;
        clearClarificationContext(msg.params.sessionId);

        const session = getSession(msg.params.sessionId);
        const plan = await runSandboxed(
          () =>
            createPlan({
              sessionId: msg.params.sessionId,
              prompt: clarifiedPrompt,
              intent: "clarified",
              platform: session.persona as any ?? "wecom",
            }),
          { timeoutMs: 600_000, label: "createPlan (clarified)" },
        );

        // Prefill plan-level initialVars so executor can seed vars (e.g. origin/recipient)
        const saveKey = (ctx.saveAs ?? ctx.clarifyStepId ?? "clarify");
        plan.initialVars = plan.initialVars ?? {};
        plan.initialVars[saveKey] = msg.params.answer;

        // Persist the modified plan and send to client
        try {
          const { savePlan } = await import("./planStore.js");
          savePlan(plan.planId, plan);
        } catch (e) {
          console.warn("[agent.clarify.response] failed to save plan with initialVars:", e?.message ?? e);
        }

        sendJSON(ws, { type: "event", event: "agent.plan.proposed", data: plan });
        sendJSON(ws, { id: msg.id, ok: true, result: { planId: plan.planId } });
        console.log("[agent.clarify.response] re-planned", msg.params.sessionId, "saved", saveKey);
        return;
      }

      // ── Direct tool action (suggested action button click) ──
      if (msg.method === "agent.run_action") {
        const { sessionId, tool, args, label } = msg.params;
        const session = getSession(sessionId);

        console.log(`[agent.run_action] tool=${tool} label="${label}" args=${JSON.stringify(args).slice(0, 200)}`);

        const emit = (event: string, data: any) => {
          sendJSON(ws, { type: "event", event, data });
        };

        // Create a minimal single-step plan and store it
        const planId = `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        savePlan(planId, {
          planId,
          sessionId,
          prompt: label ?? `Run ${tool}`,
          steps: [
            {
              id: "s1",
              tool,
              args: args ?? {},
              description: label ?? `Execute ${tool}`,
            },
          ],
          requiredPermissions: [],
        });

        const connectorId = getConnectorId(sessionId);

        const run = await executePlan({
          sessionId,
          planId,
          approved: true,
          emit,
          outboxDir,
          executeTool: async ({ step, args: resolvedArgs, timeoutMs, localExecute }) => {
            if (!CONNECTOR_TOOLS.has(step.tool)) return localExecute();
            if (!connectorId) {
              if (!REQUIRE_CONNECTOR_FOR_APPLE) return localExecute();
              return { error: "当前会话未绑定本机 Connector。" };
            }
            if (!hasConnector(connectorId)) {
              return { error: `未连接本地 Connector（${connectorId}）。` };
            }
            try {
              console.log(`[agent.run_action] dispatching ${step.tool} via connector ${connectorId}`);
              const result = await invokeConnectorTool({
                connectorId,
                tool: step.tool,
                args: resolvedArgs,
                timeoutMs: timeoutMs + 15_000,
              });
              console.log(`[agent.run_action] ${step.tool} returned: ${JSON.stringify(result).slice(0, 200)}`);
              return result;
            } catch (e: any) {
              return { error: `本地 Connector 执行失败: ${e?.message || String(e)}` };
            }
          },
        });

        try {
          const rendered = await renderFinal({ runId: run.runId, persona: session.persona });
          console.log(`[agent.run_action] rendered for tool=${tool}`);
          sendJSON(ws, { type: "event", event: "agent.rendered", data: rendered });
        } catch (renderErr: any) {
          console.error("[agent.run_action] render error:", renderErr?.message ?? renderErr);
          sendJSON(ws, {
            type: "event",
            event: "agent.rendered",
            data: {
              runId: run.runId,
              persona: session.persona,
              message: `执行已完成（${run.executionSummary.status}），但生成回复时出错。`,
            },
          });
        }

        sendJSON(ws, { id: msg.id, ok: true, result: { runId: run.runId } });
        return;
      }

      // ── Re-render with a different persona ───────────
      if (msg.method === "agent.render") {
        const session = getSession(msg.params.sessionId);
        const persona = (msg.params.persona || session.persona) as any;

        const rendered = await renderFinal({ runId: msg.params.runId, persona });
        sendJSON(ws, { type: "event", event: "agent.rendered", data: rendered });

        sendJSON(ws, { id: msg.id, ok: true });
        return;
      }

      sendJSON(ws, { id: msgId, ok: false, error: "Unknown method" });
    } catch (e: any) {
      console.error("[ws] ERROR:", e);

      sendJSON(ws, {
        type: "event",
        event: "agent.plan.error",
        data: { message: e?.message || String(e) },
      });

      sendJSON(ws, { id: msgId, ok: false, error: e?.message || String(e) });
    }
  });

  sendJSON(ws, { type: "event", event: "gateway.ready", data: { ok: true } });

  ws.on("close", () => {
    // Detect if this was a connector socket (before unregistering)
    const disconnectedConnectorId = getConnectorIdBySocket(ws as any);
    unregisterConnectorBySocket(ws as any);

    if (disconnectedConnectorId) {
      // Push offline status to all web sessions bound to this connector
      for (const [sessionId, clientWs] of sessionWebSockets.entries()) {
        if (getConnectorId(sessionId) === disconnectedConnectorId) {
          try {
            sendJSON(clientWs, {
              type: "event",
              event: "connector.status",
              data: { connectorId: disconnectedConnectorId, connected: false },
            });
          } catch { /* ignore */ }
        }
      }
    }

    // Clean up if this was a web-client socket
    for (const [sid, clientWs] of sessionWebSockets.entries()) {
      if (clientWs === ws) {
        sessionWebSockets.delete(sid);
        break;
      }
    }
  });
});

// write test

// overwrite-test
