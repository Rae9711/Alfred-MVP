/**
 * Mobile UI for Clawbot - Flow-based design with no bottom tabs
 * 
 * Features:
 * - 2-step setup: basic settings + connector binding
 * - Flow-based main screen: input → planning → planned → executing → done
 * - Settings in top-right gear icon (bottom sheet modal)
 * - Avatar tap opens customization modal
 * - API configuration for LLM providers (Gemini, Claude, Qwen, Ollama)
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import Lottie from "lottie-react";
import type { LottieRefCurrentProps } from "lottie-react";
import { Capacitor } from "@capacitor/core";
import { createWS, type EventMsg } from "./api/ws";
import {
  applyEvent,
  loadMeta,
  saveMeta,
  type AgentEventType,
  type AgentMeta,
  type AvatarState,
  currentLevelXp,
  nextLevelXp,
  getFormByLevel,
  getLevelFx,
} from "./agentMeta";
import { EVOLUTION_STATES } from "./avatarEvolution";

// ── Types ────────────────────────────────────────────────

export type AIIdentity = {
  name: string;
  persona: string;
  platform: string;
  platformTarget: string;
  createdAt: number;
  connectorId?: string;
};

export type APIConfig = {
  llmProvider: "gemini" | "claude" | "qwen" | "ollama";
  geminiKey: string;
  anthropicKey: string;
  qwenKey: string;
  ollamaUrl: string;
  braveSearchKey: string;
  kiwiKey: string;
  googleClientId: string;
  googleClientSecret: string;
};

type Phase = "input" | "planning" | "planned" | "executing" | "clarifying" | "done";

// Conversation history types
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
};

// Conversation storage helpers
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function loadConversations(): Conversation[] {
  try {
    const stored = localStorage.getItem("conversations");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  localStorage.setItem("conversations", JSON.stringify(conversations));
}

function getConversationTitle(firstMessage: string): string {
  // Use first 20 characters of the first message as title
  const cleaned = firstMessage.replace(/\n/g, " ").trim();
  return cleaned.length > 20 ? cleaned.substring(0, 20) + "..." : cleaned;
}

// ── Constants ────────────────────────────────────────────

const PERSONA_OPTIONS: Record<string, { label: string; desc: string }> = {
  professional: { label: "专业顾问", desc: "正式、结构化" },
  friendly_coach: { label: "贴心教练", desc: "友好、鼓励" },
  no_bs: { label: "直言不讳", desc: "简洁、直接" },
  playful_nerd: { label: "极客玩家", desc: "有趣、比喻" },
};

function resolvePersona(tone: "casual" | "formal", mode: "confirm" | "immediate"): string {
  if (tone === "casual" && mode === "confirm") return "friendly_coach";
  if (tone === "casual" && mode === "immediate") return "playful_nerd";
  if (tone === "formal" && mode === "confirm") return "professional";
  if (tone === "formal" && mode === "immediate") return "no_bs";
  return "professional";
}

const PLATFORMS = [
  { id: "wechat", label: "微信" },
  { id: "imessage", label: "iMessage" },
  { id: "sms", label: "短信" },
  { id: "wecom", label: "企业微信" },
  { id: "dingtalk", label: "钉钉" },
  { id: "feishu", label: "飞书" },
];

const DEFAULT_API_CONFIG: APIConfig = {
  llmProvider: "ollama",
  geminiKey: "",
  anthropicKey: "",
  qwenKey: "",
  ollamaUrl: "http://127.0.0.1:11434",
  braveSearchKey: "",
  kiwiKey: "",
  googleClientId: "",
  googleClientSecret: "",
};

// ── Helpers ──────────────────────────────────────────────

function saveIdentity(id: AIIdentity) {
  localStorage.setItem("ai_identity", JSON.stringify(id));
}

export function loadIdentity(): AIIdentity | null {
  try {
    const raw = localStorage.getItem("ai_identity");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadAPIConfig(): APIConfig {
  try {
    const saved = localStorage.getItem("mobile_api_config");
    if (saved) {
      const config = { ...DEFAULT_API_CONFIG, ...JSON.parse(saved) };
      // Migration: if provider is a cloud provider but no API key configured, reset to ollama
      if (config.llmProvider === "gemini" && !config.geminiKey) {
        config.llmProvider = "ollama";
      } else if (config.llmProvider === "claude" && !config.anthropicKey) {
        config.llmProvider = "ollama";
      } else if (config.llmProvider === "qwen" && !config.qwenKey) {
        config.llmProvider = "ollama";
      }
      return config;
    }
  } catch (e) {
    console.error("Failed to load API config:", e);
  }
  return DEFAULT_API_CONFIG;
}

function saveAPIConfig(config: APIConfig) {
  localStorage.setItem("mobile_api_config", JSON.stringify(config));
}

function getSessionId() {
  let id = localStorage.getItem("demo_session");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("demo_session", id);
  }
  return id;
}

function getWebSocketURL(token?: string): string {
  let base: string;
  // @ts-ignore
  const envUrl = import.meta.env?.VITE_WS_URL;
  if (envUrl) {
    base = envUrl;
  } else if (window.location.protocol === "https:") {
    base = `wss://${window.location.hostname}`;
  } else {
    base = "ws://localhost:8080";
  }
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function getAPIBaseUrl(): string {
  // @ts-ignore
  const envUrl = import.meta.env?.VITE_WS_URL;
  if (envUrl) {
    return envUrl.replace("ws://", "http://").replace("wss://", "https://");
  }
  if (window.location.protocol === "https:") {
    return `https://${window.location.hostname}`;
  }
  return "http://localhost:8080";
}

// ── Styles ───────────────────────────────────────────────

const styles = {
  safeArea: {
    paddingTop: "env(safe-area-inset-top, 20px)",
    paddingBottom: "env(safe-area-inset-bottom, 20px)",
    paddingLeft: "env(safe-area-inset-left, 0)",
    paddingRight: "env(safe-area-inset-right, 0)",
  } as React.CSSProperties,

  card: {
    background: "white",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },

  primaryButton: (disabled: boolean) => ({
    width: "100%",
    padding: "14px 20px",
    borderRadius: 12,
    border: "none",
    background: disabled ? "#D1D5DB" : "linear-gradient(135deg, #4F46E5, #7C3AED)",
    color: "white",
    fontWeight: 600,
    fontSize: 16,
    cursor: disabled ? "not-allowed" : "pointer",
  }),

  input: {
    width: "100%",
    padding: 14,
    borderRadius: 12,
    border: "1px solid #E5E7EB",
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box" as const,
  },

  textarea: {
    width: "100%",
    padding: 14,
    borderRadius: 12,
    border: "1px solid #E5E7EB",
    fontSize: 16,
    resize: "none" as const,
    outline: "none",
    boxSizing: "border-box" as const,
    minHeight: 120,
  },
};

// ── Mobile Setup Screen (2 Steps) ────────────────────────

export function MobileSetupScreen({ onComplete }: { onComplete: (id: AIIdentity) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [tone, setTone] = useState<"casual" | "formal">("casual");
  const [mode, setMode] = useState<"confirm" | "immediate">("confirm");
  const [platform, setPlatform] = useState("imessage");
  const [connectorId, setConnectorId] = useState("");

  const persona = resolvePersona(tone, mode);

  const goToStep2 = () => {
    if (!name.trim()) return;
    if (!connectorId) {
      setConnectorId(`${name.toLowerCase().replace(/\s+/g, "-")}-mac`);
    }
    setStep(2);
  };

  const submit = () => {
    if (!name.trim()) return;
    const plat = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[1];
    const identity: AIIdentity = {
      name: name.trim(),
      persona,
      platform: plat.id,
      platformTarget: `#${plat.id}`,
      createdAt: Date.now(),
      connectorId: connectorId.trim() || `${name.toLowerCase().replace(/\s+/g, "-")}-mac`,
    };
    localStorage.setItem(`connector_id_${getSessionId()}`, identity.connectorId || "");
    saveIdentity(identity);
    onComplete(identity);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #667eea 0%, #764ba2 100%)",
        display: "flex",
        flexDirection: "column",
        ...styles.safeArea,
        padding: 20,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 24,
          padding: 24,
          margin: "auto",
          width: "100%",
          maxWidth: 380,
          boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        {step === 1 && (
          <>
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: "linear-gradient(135deg, #4F46E5, #7C3AED)",
                  margin: "0 auto 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  color: "white",
                  fontWeight: 700,
                }}
              >
                AI
              </div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>创建AI助手</h1>
              <p style={{ margin: "6px 0 0", color: "#6B7280", fontSize: 13 }}>
                第 1 步：基本设置
              </p>
            </div>

            {/* Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                助手名称
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：阿福、小智..."
                style={styles.input}
                autoFocus
              />
            </div>

            {/* Tone */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                语气风格
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { value: "casual", label: "轻松" },
                  { value: "formal", label: "正式" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTone(opt.value as any)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: 10,
                      border: tone === opt.value ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                      background: tone === opt.value ? "#EEF2FF" : "white",
                      fontSize: 13,
                      fontWeight: tone === opt.value ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                执行模式
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { value: "confirm", label: "确认执行" },
                  { value: "immediate", label: "立即执行" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setMode(opt.value as any)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: 10,
                      border: mode === opt.value ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                      background: mode === opt.value ? "#EEF2FF" : "white",
                      fontSize: 13,
                      fontWeight: mode === opt.value ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Platform */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                默认平台
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPlatform(p.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 16,
                      border: platform === p.id ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                      background: platform === p.id ? "#EEF2FF" : "white",
                      fontSize: 12,
                      fontWeight: platform === p.id ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={goToStep2}
              disabled={!name.trim()}
              style={styles.primaryButton(!name.trim())}
            >
              下一步
            </button>
          </>
        )}

        {step === 2 && (
          <>
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: "linear-gradient(135deg, #10B981, #059669)",
                  margin: "0 auto 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontSize: 20,
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>绑定 Connector</h1>
              <p style={{ margin: "6px 0 0", color: "#6B7280", fontSize: 13 }}>
                第 2 步：连接本地工具
              </p>
            </div>

            {/* Explanation */}
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 12,
                padding: 12,
                marginBottom: 16,
                fontSize: 13,
                color: "#166534",
              }}
            >
              Connector 用于调用本地工具，如通讯录、iMessage、提醒事项等。
              请确保在你的 Mac 上运行了 Connector 程序。
            </div>

            {/* Connector ID */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                Connector ID
              </label>
              <input
                value={connectorId}
                onChange={(e) => setConnectorId(e.target.value)}
                placeholder="例如：rae-mac"
                style={styles.input}
              />
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                与 Mac 上运行的 Connector 使用相同的 ID
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  flex: 1,
                  padding: "14px 20px",
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                  background: "white",
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                返回
              </button>
              <button
                onClick={submit}
                style={{ ...styles.primaryButton(false), flex: 2 }}
              >
                开始使用
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Expandable Section Component ─────────────────────────

function SettingsSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div style={styles.card}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 14,
          color: "#111827",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          {title}
        </span>
        <span style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", fontSize: 12 }}>
          ▼
        </span>
      </button>
      {isOpen && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

// ── Config Input Helper ──────────────────────────────────

function ConfigInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  hint?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 12, color: "#6B7280", marginBottom: 4 }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={type === "password" && !showPassword ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...styles.input, padding: 10, fontSize: 13, paddingRight: type === "password" ? 40 : 10 }}
        />
        {type === "password" && value && (
          <button
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              color: "#6B7280",
            }}
          >
            {showPassword ? "🙈" : "👁️"}
          </button>
        )}
      </div>
      {hint && <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

// ── Settings Modal (with API Config) ─────────────────────

function SettingsModal({
  identity,
  connectorId,
  connectorOnline,
  tone,
  actionMode,
  onSetConnectorId,
  onSetTone,
  onSetActionMode,
  onSaveAPIConfig,
  onReset,
  onLogout,
  onClose,
}: {
  identity: AIIdentity;
  connectorId: string;
  connectorOnline: boolean;
  tone: "casual" | "formal";
  actionMode: "confirm" | "immediate";
  onSetConnectorId: (id: string) => void;
  onSetTone: (t: "casual" | "formal") => void;
  onSetActionMode: (m: "confirm" | "immediate") => void;
  onSaveAPIConfig: (config: APIConfig) => void;
  onReset: () => void;
  onLogout?: () => void;
  onClose: () => void;
}) {
  const [localConnectorId, setLocalConnectorId] = useState(connectorId);
  const [apiConfig, setApiConfig] = useState<APIConfig>(loadAPIConfig);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const updateConfig = <K extends keyof APIConfig>(key: K, value: APIConfig[K]) => {
    setApiConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveAPIConfig = async () => {
    saveAPIConfig(apiConfig);
    
    // Sync to backend
    try {
      const res = await fetch(`${getAPIBaseUrl()}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiConfig),
      });
      if (res.ok) {
        console.log("[API Config] Synced to server");
      }
    } catch (e) {
      console.warn("[API Config] Failed to sync to server:", e);
    }
    
    onSaveAPIConfig(apiConfig);
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: "24px 24px 0 0",
          padding: 20,
          paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0))",
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          animation: "slideUp 0.3s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div
          style={{
            width: 36,
            height: 4,
            background: "#D1D5DB",
            borderRadius: 2,
            margin: "0 auto 16px",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>设置</div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              border: "none",
              background: "#F3F4F6",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              color: "#6B7280",
            }}
          >
            ×
          </button>
        </div>

        {/* Connector */}
        <div style={styles.card}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Connector</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={localConnectorId}
              onChange={(e) => setLocalConnectorId(e.target.value)}
              placeholder="connector-id"
              style={{ ...styles.input, flex: 1, padding: 10, fontSize: 14 }}
            />
            <button
              onClick={() => onSetConnectorId(localConnectorId)}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: "#4F46E5",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              绑定
            </button>
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: connectorOnline ? "#059669" : "#9CA3AF",
            }}
          >
            {connectorOnline ? `已连接: ${connectorId}` : "未连接"}
          </div>
        </div>

        {/* Tone */}
        <div style={styles.card}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>语气风格</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { value: "casual", label: "轻松" },
              { value: "formal", label: "正式" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSetTone(opt.value as any)}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: 10,
                  border: tone === opt.value ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                  background: tone === opt.value ? "#EEF2FF" : "white",
                  fontWeight: tone === opt.value ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Mode */}
        <div style={styles.card}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>执行模式</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { value: "confirm", label: "确认执行" },
              { value: "immediate", label: "立即执行" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSetActionMode(opt.value as any)}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: 10,
                  border: actionMode === opt.value ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                  background: actionMode === opt.value ? "#EEF2FF" : "white",
                  fontWeight: actionMode === opt.value ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── API Configuration ─── */}
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 20, marginBottom: 12, color: "#374151" }}>
          AI 模型
        </div>

        {/* LLM Provider - Always visible */}
        <div style={styles.card}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>选择 AI 服务</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { value: "ollama", label: "Ollama", desc: "本地免费", icon: "🏠" },
              { value: "gemini", label: "Gemini", desc: "需API", icon: "✨" },
              { value: "claude", label: "Claude", desc: "需API", icon: "🧠" },
              { value: "qwen", label: "千问", desc: "需API", icon: "🌐" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateConfig("llmProvider", opt.value as APIConfig["llmProvider"])}
                style={{
                  flex: "1 1 45%",
                  padding: "12px 10px",
                  borderRadius: 12,
                  border: apiConfig.llmProvider === opt.value ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                  background: apiConfig.llmProvider === opt.value ? "#EEF2FF" : "white",
                  fontSize: 14,
                  fontWeight: apiConfig.llmProvider === opt.value ? 600 : 400,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          
          {/* API Key Config based on selected provider */}
          {apiConfig.llmProvider === "ollama" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ background: "#D1FAE5", border: "1px solid #6EE7B7", borderRadius: 8, padding: 10, fontSize: 12, color: "#065F46", marginBottom: 10 }}>
                ✓ 本地运行，无需 API Key。请确保 Ollama 正在运行（brew install ollama && ollama serve）
              </div>
              <ConfigInput
                label="Ollama URL"
                value={apiConfig.ollamaUrl}
                onChange={(v) => updateConfig("ollamaUrl", v)}
                placeholder="http://127.0.0.1:11434"
              />
            </div>
          )}
          
          {apiConfig.llmProvider === "gemini" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ background: "#DBEAFE", border: "1px solid #93C5FD", borderRadius: 8, padding: 10, fontSize: 12, color: "#1E40AF", marginBottom: 10 }}>
                从 aistudio.google.com/app/apikey 获取免费 API Key（每分钟15次）
              </div>
              <ConfigInput
                label="Gemini API Key"
                value={apiConfig.geminiKey}
                onChange={(v) => updateConfig("geminiKey", v)}
                placeholder="AIza..."
                type="password"
              />
            </div>
          )}
          
          {apiConfig.llmProvider === "claude" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, padding: 10, fontSize: 12, color: "#92400E", marginBottom: 10 }}>
                从 console.anthropic.com 获取 API Key（付费）
              </div>
              <ConfigInput
                label="Anthropic API Key"
                value={apiConfig.anthropicKey}
                onChange={(v) => updateConfig("anthropicKey", v)}
                placeholder="sk-ant-..."
                type="password"
              />
            </div>
          )}
          
          {apiConfig.llmProvider === "qwen" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, padding: 10, fontSize: 12, color: "#991B1B", marginBottom: 10 }}>
                从 dashscope.aliyun.com 获取 API Key
              </div>
              <ConfigInput
                label="通义千问 API Key"
                value={apiConfig.qwenKey}
                onChange={(v) => updateConfig("qwenKey", v)}
                placeholder="sk-..."
                type="password"
              />
            </div>
          )}
        </div>

        {/* Web Search */}
        <SettingsSection title="网络搜索" icon="🔍">
          {apiConfig.llmProvider === "gemini" ? (
            <div style={{ background: "#D1FAE5", border: "1px solid #6EE7B7", borderRadius: 8, padding: 8, fontSize: 12, color: "#065F46" }}>
              Gemini 已内置 Google Search，无需额外配置
            </div>
          ) : (
            <ConfigInput
              label="Brave Search API Key"
              value={apiConfig.braveSearchKey}
              onChange={(v) => updateConfig("braveSearchKey", v)}
              placeholder="BSA..."
              type="password"
              hint="从 brave.com/search/api 获取（免费每月 2000 次）"
            />
          )}
        </SettingsSection>

        {/* Flight Search */}
        <SettingsSection title="航班搜索" icon="✈️">
          <ConfigInput
            label="Kiwi API Key"
            value={apiConfig.kiwiKey}
            onChange={(v) => updateConfig("kiwiKey", v)}
            placeholder=""
            type="password"
            hint="从 tequila.kiwi.com 获取"
          />
        </SettingsSection>

        {/* Save API Config Button */}
        <button
          onClick={handleSaveAPIConfig}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 12,
            border: "none",
            background: showSaveSuccess ? "#10B981" : "linear-gradient(135deg, #4F46E5, #7C3AED)",
            color: "white",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            marginTop: 12,
            marginBottom: 10,
            transition: "background 0.3s",
          }}
        >
          {showSaveSuccess ? "已保存 ✓" : "保存 API 配置"}
        </button>

        {/* Actions */}
        <button
          onClick={onReset}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 12,
            border: "1px solid #E5E7EB",
            background: "white",
            fontSize: 15,
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          重新设置助手
        </button>

        {onLogout && (
          <button
            onClick={onLogout}
            style={{
              width: "100%",
              padding: 14,
              borderRadius: 12,
              border: "1px solid #FCA5A5",
              background: "#FEF2F2",
              color: "#DC2626",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            登出
          </button>
        )}

        <style>{`
          @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}

// ── Avatar Modal ─────────────────────────────────────────

function AvatarModal({
  agentName,
  meta,
  state,
  onClose,
  onSetColor,
}: {
  agentName: string;
  meta: AgentMeta;
  state: AvatarState;
  onClose: () => void;
  onSetColor: (color: string) => void;
}) {
  const form = getFormByLevel(meta.level);
  const levelFx = getLevelFx(meta.level);
  const [animationData, setAnimationData] = useState<any>(null);
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);

  const stateConfig = useMemo(() => EVOLUTION_STATES[state], [state]);

  useEffect(() => {
    fetch(`/lottie/${form.lottieSkin}`)
      .then((res) => res.json())
      .then(setAnimationData)
      .catch(console.error);
  }, [form.lottieSkin]);

  useEffect(() => {
    const ref = lottieRef.current;
    if (!ref || !animationData) return;
    const seg = stateConfig?.segment;
    if (seg) {
      ref.playSegments(seg as [number, number], true);
    }
  }, [stateConfig, animationData]);

  const colors = ["#4F46E5", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#8B5CF6", "#3B82F6", "#6366F1"];

  const currXp = currentLevelXp(meta.level);
  const nxtXp = nextLevelXp(meta.level);
  const progress = Math.min(1, (meta.xp - currXp) / (nxtXp - currXp));

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: 24,
          padding: 24,
          width: "100%",
          maxWidth: 340,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Avatar Display */}
        <div
          style={{
            width: 120,
            height: 120,
            margin: "0 auto 16px",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${meta.color}33, ${meta.color}11)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `3px solid ${meta.color}`,
          }}
        >
          {animationData ? (
            <Lottie
              lottieRef={lottieRef}
              animationData={animationData}
              loop
              style={{ width: 90, height: 90, filter: levelFx.filter }}
            />
          ) : (
            <div style={{ fontSize: 48, fontWeight: 700, color: meta.color }}>{agentName[0]}</div>
          )}
        </div>

        {/* Name & Level */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{agentName}</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>
            {form.name} · Lv.{meta.level}
          </div>
        </div>

        {/* XP Progress */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B7280", marginBottom: 4 }}>
            <span>XP: {meta.xp}</span>
            <span>{nxtXp}</span>
          </div>
          <div style={{ height: 8, background: "#E5E7EB", borderRadius: 4, overflow: "hidden" }}>
            <div
              style={{
                width: `${progress * 100}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${meta.color}, #7C3AED)`,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>

        {/* Color Picker */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>主题颜色</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => onSetColor(c)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: c,
                  border: meta.color === c ? "3px solid #111" : "2px solid transparent",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #E5E7EB",
            background: "white",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

// ── Task Complete Toast ──────────────────────────────────

function TaskCompleteToast({ message, type = "success", onDismiss }: { message: string; type?: "success" | "error"; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const bgColor = type === "error" ? "#DC2626" : "#10B981";
  const icon = type === "error" ? "✗" : "✓";

  return (
    <div
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 20px) + 60px)",
        left: 20,
        right: 20,
        background: bgColor,
        color: "white",
        padding: "12px 16px",
        borderRadius: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 300,
        animation: "slideDown 0.3s ease-out",
      }}
      onClick={onDismiss}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ flex: 1, fontWeight: 500 }}>{message}</span>
      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Mobile Main Screen (Flow-based UI) ───────────────────

export function MobileMainScreen({
  identity,
  accessToken,
  onReset,
  onLogout,
}: {
  identity: AIIdentity;
  accessToken?: string;
  onReset: () => void;
  onLogout?: () => void;
}) {
  const sessionId = useMemo(() => getSessionId(), []);
  const metaStorageKey = useMemo(
    () => `agent_meta_${sessionId}_${identity.createdAt}`,
    [sessionId, identity.createdAt],
  );

  // Core state
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [finalMsg, setFinalMsg] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [wsClient, setWsClient] = useState<any>(null);
  const [connected, setConnected] = useState(false);

  // Permissions
  const [approvedPermissions, setApprovedPermissions] = useState<Set<string>>(new Set());

  // Clarification
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  // Manual address fallback
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [manualFallbackReason, setManualFallbackReason] = useState("");
  const [manualAddress, setManualAddress] = useState("");

  // File upload
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);

  // Connector
  const [connectorId, setConnectorId] = useState<string>(() => {
    return localStorage.getItem(`connector_id_${sessionId}`) || identity.connectorId || "";
  });
  const [connectorOnline, setConnectorOnline] = useState(false);

  // Settings
  const [actionMode, setActionMode] = useState<"confirm" | "immediate">(() => {
    return (localStorage.getItem("action_mode") as any) || "confirm";
  });
  const [tone, setTone] = useState<"casual" | "formal">(() => {
    return (localStorage.getItem("tone_pref") as any) || "casual";
  });
  const [showSettings, setShowSettings] = useState(false);

  // Avatar
  const [agentMeta, setAgentMeta] = useState<AgentMeta>(() => loadMeta(metaStorageKey));
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  // Toast
  const [showCompleteToast, setShowCompleteToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  // Step summary for execution
  const [stepSummary, setStepSummary] = useState<Array<{ tool: string; status: string; desc?: string }>>([]);
  const hasToolErrorRef = React.useRef(false);

  // Conversation history
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showHistorySidebar, setShowHistorySidebar] = useState(false);

  // Get current conversation
  const currentConversation = useMemo(() => {
    return conversations.find(c => c.id === currentConversationId) || null;
  }, [conversations, currentConversationId]);

  const platLabel = PLATFORMS.find((p) => p.id === identity.platform)?.label ?? identity.platform;

  const applyProgressEvent = (eventType: AgentEventType) => {
    setAgentMeta((prev) => {
      const result = applyEvent(prev, eventType);
      saveMeta(metaStorageKey, result.next);
      return result.next;
    });
  };

  // WebSocket setup
  useEffect(() => {
    const wsUrl = getWebSocketURL(accessToken);
    const client = createWS(wsUrl, (m: EventMsg) => {
      if (m.type === "event") {
        const ev = m.event ?? "";
        const data = m.data;

        if (ev === "gateway.ready") {
          setConnected(true);
          setAvatarState("idle");
        }

        if (ev === "agent.plan.proposed") {
          setPlan(data);
          setPhase("planned");
          setAvatarState("idle");
        }

        if (ev === "agent.clarify") {
          setClarifyQuestion(data?.question ?? "请提供更多信息");
          setClarifyAnswer("");
          setPhase("clarifying");
          setAvatarState("thinking");
        }

        if (ev === "agent.plan.error") {
          const errMsg = data?.message || data?.error || "任务失败";
          setErrorMessage(errMsg);
          setFinalMsg("");
          setPhase("done");
          setAvatarState("error");
        }

        if (ev === "tool.success") {
          applyProgressEvent("tool_used");
          setStepSummary((prev) => [...prev, { tool: data?.tool ?? "unknown", status: "ok", desc: data?.description }]);
        }

        if (ev === "tool.error") {
          setStepSummary((prev) => [...prev, { tool: data?.tool ?? "unknown", status: "error", desc: data?.error }]);
          setAvatarState("error");
          hasToolErrorRef.current = true;

          const toolId = String(data?.tool ?? "");
          const errorText = String(data?.error ?? "");
          if (
            toolId === "contacts.apple" ||
            (toolId === "imessage.send" && /无法获取|requires a handle|\[missing:|\[error:/i.test(errorText))
          ) {
            setShowManualFallback(true);
            setManualFallbackReason(errorText || "联系人查找失败");
          }
        }

        if (ev === "agent.exec.started") {
          setPhase("executing");
          setAvatarState("focused");
        }

        if (ev === "agent.exec.finished") {
          setAvatarState("success");
        }

        if (ev === "agent.rendered") {
          setFinalMsg(data.message);
          setErrorMessage(null);
          setPhase("done");
          
          // Save assistant response to conversation
          if (data.message) {
            setConversations(prev => {
              if (!currentConversationId) return prev;
              const updated = prev.map(conv => {
                if (conv.id === currentConversationId) {
                  const assistantMsg: ConversationMessage = {
                    id: generateId(),
                    role: "assistant",
                    content: data.message,
                    timestamp: Date.now(),
                  };
                  return {
                    ...conv,
                    messages: [...conv.messages, assistantMsg],
                    updatedAt: Date.now(),
                  };
                }
                return conv;
              });
              saveConversations(updated);
              return updated;
            });
          }
          
          // Check if there were tool errors
          if (hasToolErrorRef.current) {
            setAvatarState("error");
            setToastType("error");
            setToastMessage("任务失败");
          } else {
            setAvatarState("success");
            applyProgressEvent("task_completed");
            setToastType("success");
            setToastMessage("任务完成");
          }
          setShowCompleteToast(true);
        }
      } else {
        if (m.result?.planId) setPlanId(m.result.planId);
        if (m.result?.runId) setRunId(m.result.runId);
        if (m.result?.connectorId) setConnectorOnline(!!m.result.connected);
      }
    });
    setWsClient(client);

    return () => {};
  }, [accessToken]);

  // Sync persona on connect
  useEffect(() => {
    if (!wsClient) return;
    wsClient.call("session.setPersona", { sessionId, persona: identity.persona });
    wsClient.call("session.setActionMode", { sessionId, mode: actionMode });
  }, [wsClient, sessionId, identity.persona, actionMode]);

  // Auto-sync API settings to backend on connect
  useEffect(() => {
    if (!connected) return;
    const config = loadAPIConfig();
    // Only sync if user has configured an API key
    if (config.geminiKey || config.anthropicKey || config.qwenKey) {
      fetch(`${getAPIBaseUrl()}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
        .then((res) => {
          if (res.ok) console.log("[API] Settings synced to backend");
        })
        .catch((e) => console.warn("[API] Failed to sync settings:", e));
    }
  }, [connected]);

  // Bind connector
  useEffect(() => {
    localStorage.setItem(`connector_id_${sessionId}`, connectorId);
    if (wsClient && connectorId.trim()) {
      wsClient.call("session.bindConnector", { sessionId, connectorId: connectorId.trim() });
    }
  }, [wsClient, connectorId, sessionId]);

  // ── Actions ──────────────────────────────────────────

  const addMessageToConversation = (role: "user" | "assistant", content: string) => {
    const message: ConversationMessage = {
      id: generateId(),
      role,
      content,
      timestamp: Date.now(),
    };

    setConversations(prev => {
      let updated: Conversation[];
      
      if (currentConversationId) {
        // Add to existing conversation
        updated = prev.map(conv => {
          if (conv.id === currentConversationId) {
            return {
              ...conv,
              messages: [...conv.messages, message],
              updatedAt: Date.now(),
            };
          }
          return conv;
        });
      } else {
        // Create new conversation
        const newConv: Conversation = {
          id: generateId(),
          title: role === "user" ? getConversationTitle(content) : "新对话",
          messages: [message],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setCurrentConversationId(newConv.id);
        updated = [newConv, ...prev];
      }
      
      saveConversations(updated);
      return updated;
    });
  };

  const startPlanning = (nextPrompt: string) => {
    if (!wsClient || !nextPrompt.trim()) return;

    let finalPrompt = nextPrompt;
    
    // Include conversation history for context (if exists)
    if (currentConversation && currentConversation.messages.length > 0) {
      const historyContext = currentConversation.messages
        .slice(-6) // Last 6 messages for context
        .map(m => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
        .join("\n\n");
      finalPrompt = `[对话历史]\n${historyContext}\n\n[当前请求]\n${nextPrompt}`;
    }
    
    if (uploadedFileId) {
      finalPrompt = `${finalPrompt}\n\n[Attached file: ${uploadedFileId}]`;
    }

    // Save user message to conversation
    addMessageToConversation("user", nextPrompt);

    setFinalMsg("");
    setRunId(null);
    setPlanId(null);
    setPlan(null);
    setApprovedPermissions(new Set());
    setShowManualFallback(false);
    setManualFallbackReason("");
    setStepSummary([]);
    hasToolErrorRef.current = false;
    setPhase("planning");
    setAvatarState("thinking");

    applyProgressEvent("streak_day");
    applyProgressEvent("agent_message_sent");

    wsClient.call("agent.plan", {
      sessionId,
      intent: "process_text",
      prompt: finalPrompt,
      platform: identity.platform,
    });
  };

  const askPlan = () => {
    startPlanning(prompt);
  };

  const retryWithAddress = () => {
    const addr = manualAddress.trim();
    if (!addr) return;
    const merged = `${prompt.trim()}\n收件人地址：${addr}`;
    setPrompt(merged);
    startPlanning(merged);
  };

  const togglePermission = (perm: string) => {
    setApprovedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  const requiredPerms: string[] = plan?.requiredPermissions ?? [];
  const allPermsApproved = requiredPerms.length === 0 || requiredPerms.every((p) => approvedPermissions.has(p));

  const approve = () => {
    if (!wsClient || !planId || !allPermsApproved) return;
    wsClient.call("agent.execute", { sessionId, planId, approved: true });
  };

  const submitClarification = () => {
    if (!wsClient || !clarifyAnswer.trim()) return;
    setPhase("planning");
    setAvatarState("thinking");
    wsClient.call("agent.clarify.response", { sessionId, answer: clarifyAnswer.trim() });
    setClarifyQuestion("");
    setClarifyAnswer("");
  };

  const handleSetColor = (color: string) => {
    setAgentMeta((prev) => {
      const next = { ...prev, color };
      saveMeta(metaStorageKey, next);
      return next;
    });
  };

  const handleSaveAPIConfig = (config: APIConfig) => {
    console.log("[API Config] Saved:", config);
  };

  const updateConnectorId = (id: string) => {
    setConnectorId(id);
    setConnectorOnline(false);
    if (wsClient && id.trim()) {
      wsClient.call("session.bindConnector", { sessionId, connectorId: id.trim() });
    }
  };

  const updateTone = (t: "casual" | "formal") => {
    setTone(t);
    localStorage.setItem("tone_pref", t);
    if (wsClient) {
      const newPersona = resolvePersona(t, actionMode);
      wsClient.call("session.setPersona", { sessionId, persona: newPersona });
    }
  };

  const updateActionMode = (m: "confirm" | "immediate") => {
    setActionMode(m);
    localStorage.setItem("action_mode", m);
    if (wsClient) {
      wsClient.call("session.setActionMode", { sessionId, mode: m });
      const newPersona = resolvePersona(tone, m);
      wsClient.call("session.setPersona", { sessionId, persona: newPersona });
    }
  };

  // Continue in current conversation (followup)
  const newTask = () => {
    setPhase("input");
    setPrompt("");
    setPlan(null);
    setFinalMsg("");
    setErrorMessage(null);
    setUploadedFileId(null);
    setAvatarState("idle");
    setStepSummary([]);
    hasToolErrorRef.current = false;
    // Keep currentConversationId for followup
  };

  // Start completely new conversation
  const startNewConversation = () => {
    setPhase("input");
    setPrompt("");
    setPlan(null);
    setFinalMsg("");
    setErrorMessage(null);
    setUploadedFileId(null);
    setAvatarState("idle");
    setStepSummary([]);
    hasToolErrorRef.current = false;
    setCurrentConversationId(null); // This will create a new conversation on next message
  };

  // Switch to a specific conversation
  const switchToConversation = (convId: string) => {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    
    setCurrentConversationId(convId);
    setShowHistorySidebar(false);
    
    // Show the last AI response if exists
    const lastAssistantMsg = [...conv.messages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg) {
      setFinalMsg(lastAssistantMsg.content);
      setPhase("done");
    } else {
      setPhase("input");
      setFinalMsg("");
    }
    
    setPrompt("");
    setPlan(null);
    setErrorMessage(null);
    setStepSummary([]);
  };

  // Delete a conversation
  const deleteConversation = (convId: string) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== convId);
      saveConversations(updated);
      return updated;
    });
    if (currentConversationId === convId) {
      setCurrentConversationId(null);
      setPhase("input");
      setFinalMsg("");
    }
  };

  // ── Render ───────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F5F7",
        display: "flex",
        flexDirection: "column",
        ...styles.safeArea,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "linear-gradient(135deg, #4F46E5, #7C3AED)",
          padding: "14px 16px",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Avatar (clickable) */}
        <div
          onClick={() => setShowAvatarModal(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: `radial-gradient(circle, ${agentMeta.color}66, rgba(255,255,255,0.2))`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
              border: "2px solid rgba(255,255,255,0.3)",
            }}
          >
            {identity.name[0]}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{identity.name}</div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>
              Lv.{agentMeta.level} · {platLabel}
            </div>
          </div>
        </div>

        {/* Right side: status + settings */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 12,
              background: connected ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {connected ? "在线" : "连接中..."}
          </div>
          {/* History button */}
          <button
            onClick={() => setShowHistorySidebar(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(255,255,255,0.2)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v4l3 3"/>
              <circle cx="12" cy="12" r="9"/>
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(255,255,255,0.2)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
        {/* Input Phase */}
        {phase === "input" && (
          <>
            {/* Show conversation context if in existing conversation */}
            {currentConversation && currentConversation.messages.length > 0 && (
              <div style={{ ...styles.card, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#6B7280" }}>
                    当前对话
                  </div>
                  <button
                    onClick={startNewConversation}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "1px solid #E5E7EB",
                      background: "white",
                      fontSize: 12,
                      cursor: "pointer",
                      color: "#6B7280",
                    }}
                  >
                    新对话
                  </button>
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {currentConversation.messages.slice(-4).map((msg) => (
                    <div
                      key={msg.id}
                      style={{
                        padding: "8px 10px",
                        marginBottom: 6,
                        borderRadius: 8,
                        background: msg.role === "user" ? "#EEF2FF" : "#F3F4F6",
                        fontSize: 12,
                        lineHeight: 1.4,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 10, color: msg.role === "user" ? "#4F46E5" : "#6B7280", marginBottom: 2 }}>
                        {msg.role === "user" ? "你" : identity.name}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden" }}>
                        {msg.content.length > 150 ? msg.content.substring(0, 150) + "..." : msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={styles.card}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>
                {currentConversation ? "继续对话" : "输入任务"}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={currentConversation ? "继续提问..." : "告诉我你想要做什么..."}
                style={styles.textarea}
                rows={4}
              />
            </div>

            <button
              onClick={askPlan}
              disabled={!prompt.trim() || !connected}
              style={styles.primaryButton(!prompt.trim() || !connected)}
            >
              {currentConversation ? "发送" : "生成方案"}
            </button>
          </>
        )}

        {/* Planning Phase */}
        {phase === "planning" && (
          <div style={{ ...styles.card, textAlign: "center", padding: 40 }}>
            <div
              style={{
                width: 60,
                height: 60,
                margin: "0 auto 16px",
                borderRadius: "50%",
                border: "3px solid #4F46E5",
                borderTopColor: "transparent",
                animation: "spin 1s linear infinite",
              }}
            />
            <div style={{ fontWeight: 600, fontSize: 16 }}>正在思考...</div>
            <div style={{ color: "#6B7280", fontSize: 13, marginTop: 6 }}>
              {identity.name} 正在分析你的请求
            </div>
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}

        {/* Clarifying Phase */}
        {phase === "clarifying" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14, color: "#F59E0B" }}>
              需要补充信息
            </div>
            <div style={{ background: "#FEF3C7", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 14 }}>
              {clarifyQuestion}
            </div>
            <textarea
              value={clarifyAnswer}
              onChange={(e) => setClarifyAnswer(e.target.value)}
              placeholder="请输入补充信息..."
              style={{ ...styles.textarea, minHeight: 80 }}
            />
            <button
              onClick={submitClarification}
              disabled={!clarifyAnswer.trim()}
              style={{ ...styles.primaryButton(!clarifyAnswer.trim()), marginTop: 12 }}
            >
              提交
            </button>
          </div>
        )}

        {/* Planned Phase */}
        {phase === "planned" && plan && (
          <>
            <div style={styles.card}>
              <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>执行计划</div>
              {plan.steps?.map((step: any, i: number) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: i < plan.steps.length - 1 ? "1px solid #E5E7EB" : "none",
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "#EEF2FF",
                      color: "#4F46E5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{step.tool}</div>
                    <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                      {step.description || JSON.stringify(step.args || {})}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Permissions */}
            {requiredPerms.length > 0 && (
              <div style={styles.card}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>需要权限</div>
                {requiredPerms.map((perm) => (
                  <label
                    key={perm}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={approvedPermissions.has(perm)}
                      onChange={() => togglePermission(perm)}
                      style={{ width: 18, height: 18, accentColor: "#4F46E5" }}
                    />
                    <span style={{ fontSize: 13 }}>{perm}</span>
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={approve}
              disabled={!allPermsApproved}
              style={styles.primaryButton(!allPermsApproved)}
            >
              批准执行
            </button>
          </>
        )}

        {/* Executing Phase */}
        {phase === "executing" && (
          <div style={styles.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "2px solid #4F46E5",
                  borderTopColor: "transparent",
                  animation: "spin 1s linear infinite",
                }}
              />
              <div style={{ fontWeight: 600, fontSize: 14 }}>正在执行...</div>
            </div>

            {stepSummary.map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: i < stepSummary.length - 1 ? "1px solid #E5E7EB" : "none",
                }}
              >
                <span style={{ fontSize: 14 }}>{s.status === "ok" ? "✓" : "✗"}</span>
                <span style={{ fontSize: 13, color: s.status === "ok" ? "#059669" : "#DC2626" }}>
                  {s.tool}
                </span>
              </div>
            ))}

            {/* Manual address fallback */}
            {showManualFallback && (
              <div style={{ marginTop: 16, padding: 12, background: "#FEF3C7", borderRadius: 12 }}>
                <div style={{ fontSize: 13, color: "#92400E", marginBottom: 8 }}>
                  {manualFallbackReason}
                </div>
                <input
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  placeholder="手动输入手机号或邮箱"
                  style={{ ...styles.input, padding: 10, fontSize: 13, marginBottom: 8 }}
                />
                <button
                  onClick={retryWithAddress}
                  disabled={!manualAddress.trim()}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 8,
                    border: "none",
                    background: manualAddress.trim() ? "#F59E0B" : "#D1D5DB",
                    color: "white",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: manualAddress.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  重试
                </button>
              </div>
            )}

            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}

        {/* Done Phase */}
        {phase === "done" && (() => {
          const hasToolErrors = stepSummary.some(s => s.status === "error");
          const failedSteps = stepSummary.filter(s => s.status === "error");
          const isFailure = errorMessage || hasToolErrors;
          
          return (
          <>
            <div style={styles.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                {isFailure ? (
                  <>
                    <span style={{ fontSize: 20, color: "#DC2626" }}>✗</span>
                    <span style={{ fontWeight: 600, fontSize: 14, color: "#DC2626" }}>任务失败</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 20, color: "#10B981" }}>✓</span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>执行完成</span>
                  </>
                )}
              </div>

              {/* Error message from plan error */}
              {errorMessage && (
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 16,
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#991B1B",
                  }}
                >
                  {errorMessage}
                </div>
              )}

              {/* Tool error details */}
              {hasToolErrors && !errorMessage && (
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 16,
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#991B1B",
                  }}
                >
                  {failedSteps.map((s, i) => (
                    <div key={i} style={{ marginBottom: i < failedSteps.length - 1 ? 8 : 0 }}>
                      <strong>{s.tool}:</strong> {s.desc || "执行失败"}
                    </div>
                  ))}
                </div>
              )}

              {/* Step summary */}
              {stepSummary.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {stepSummary.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 0",
                        fontSize: 13,
                        color: s.status === "ok" ? "#059669" : "#DC2626",
                      }}
                    >
                      <span>{s.status === "ok" ? "✓" : "✗"}</span>
                      <span>{s.tool}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Final message - show even if there were tool errors */}
              {finalMsg && (
                <div
                  style={{
                    background: isFailure ? "#FEF2F2" : "#F3F4F6",
                    borderRadius: 12,
                    padding: 14,
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8, color: isFailure ? "#DC2626" : "#111827" }}>
                    AI 回复
                  </div>
                  {finalMsg}
                </div>
              )}
            </div>

            {/* Followup Input */}
            <div style={styles.card}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>继续对话</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="继续提问或发送新指令..."
                style={styles.textarea}
                rows={3}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  onClick={askPlan}
                  disabled={!prompt.trim() || !connected}
                  style={{
                    ...styles.primaryButton(!prompt.trim() || !connected),
                    flex: 1,
                  }}
                >
                  发送
                </button>
                <button
                  onClick={startNewConversation}
                  style={{
                    flex: 1,
                    padding: "12px 20px",
                    borderRadius: 10,
                    border: "1px solid #E5E7EB",
                    background: "white",
                    color: "#6B7280",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  新对话
                </button>
              </div>
            </div>

            {/* Conversation History */}
            {currentConversation && currentConversation.messages.length > 2 && (
              <div style={{ ...styles.card, marginTop: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14, color: "#6B7280" }}>
                  对话记录
                </div>
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                  {currentConversation.messages.slice(0, -2).map((msg, i) => (
                    <div
                      key={msg.id}
                      style={{
                        padding: "10px 12px",
                        marginBottom: 8,
                        borderRadius: 10,
                        background: msg.role === "user" ? "#EEF2FF" : "#F3F4F6",
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 11, color: msg.role === "user" ? "#4F46E5" : "#6B7280", marginBottom: 4 }}>
                        {msg.role === "user" ? "你" : identity.name}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", maxHeight: 100, overflow: "hidden" }}>
                        {msg.content.length > 200 ? msg.content.substring(0, 200) + "..." : msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );})()}
      </div>

      {/* Modals */}
      {showSettings && (
        <SettingsModal
          identity={identity}
          connectorId={connectorId}
          connectorOnline={connectorOnline}
          tone={tone}
          actionMode={actionMode}
          onSetConnectorId={updateConnectorId}
          onSetTone={updateTone}
          onSetActionMode={updateActionMode}
          onSaveAPIConfig={handleSaveAPIConfig}
          onReset={onReset}
          onLogout={onLogout}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAvatarModal && (
        <AvatarModal
          agentName={identity.name}
          meta={agentMeta}
          state={avatarState}
          onClose={() => setShowAvatarModal(false)}
          onSetColor={handleSetColor}
        />
      )}

      {showCompleteToast && (
        <TaskCompleteToast message={toastMessage} type={toastType} onDismiss={() => setShowCompleteToast(false)} />
      )}

      {/* History Sidebar */}
      {showHistorySidebar && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 1000,
            display: "flex",
          }}
        >
          {/* Backdrop */}
          <div
            onClick={() => setShowHistorySidebar(false)}
            style={{
              flex: 1,
              background: "rgba(0,0,0,0.4)",
            }}
          />
          {/* Sidebar */}
          <div
            style={{
              width: 280,
              background: "white",
              boxShadow: "-4px 0 20px rgba(0,0,0,0.1)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Sidebar Header */}
            <div
              style={{
                padding: "16px",
                borderBottom: "1px solid #E5E7EB",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 16 }}>对话历史</span>
              <button
                onClick={() => setShowHistorySidebar(false)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "#6B7280",
                }}
              >
                ✕
              </button>
            </div>

            {/* New Conversation Button */}
            <button
              onClick={() => {
                startNewConversation();
                setShowHistorySidebar(false);
              }}
              style={{
                margin: "12px 16px",
                padding: "10px 16px",
                borderRadius: 8,
                border: "1px solid #4F46E5",
                background: "#4F46E5",
                color: "white",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 18 }}>+</span>
              新对话
            </button>

            {/* Conversation List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
              {conversations.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
                  暂无对话记录
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    style={{
                      padding: "12px",
                      marginBottom: 4,
                      borderRadius: 8,
                      background: conv.id === currentConversationId ? "#EEF2FF" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                    onClick={() => switchToConversation(conv.id)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: conv.id === currentConversationId ? 600 : 400,
                          fontSize: 14,
                          color: "#111827",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {conv.title}
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                        {new Date(conv.updatedAt).toLocaleDateString()} · {conv.messages.length}条消息
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      style={{
                        border: "none",
                        background: "none",
                        color: "#DC2626",
                        fontSize: 14,
                        cursor: "pointer",
                        padding: "4px 8px",
                        opacity: 0.6,
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Check if on native platform ──────────────────────────

export function isMobilePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
