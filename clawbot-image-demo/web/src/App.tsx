import React, { useEffect, useMemo, useState } from "react";
import { createWS, type EventMsg } from "./api/ws";
import ProposedPlan from "./components/ProposedPlan";
import ExecutionLog from "./components/ExecutionLog";
import FinalAnswer from "./components/FinalAnswer";
import AgentAvatarCard from "./components/AgentAvatarCard";
import AuthScreen from "./components/AuthScreen";
import APISettings, { loadAPIConfig, saveAPIConfig, type APIConfig } from "./components/APISettings";
import { isAuthEnabled } from "./api/supabase";
import {
  applyEvent,
  equipCosmetic,
  loadMeta,
  saveMeta,
  setCustomCosmeticAsset,
  type AgentEventType,
  type AgentMeta,
  type AvatarState,
  type CosmeticSlot,
} from "./agentMeta";

// Auto-detect WebSocket URL from current hostname if accessed via ngrok
function getWebSocketURL(token?: string): string {
  let base: string;
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) {
    base = envUrl;
  } else if (window.location.protocol === 'https:') {
    const wsProtocol = 'wss:';
    const hostname = window.location.hostname;
    base = `${wsProtocol}//${hostname}`;
  } else {
    base = "ws://localhost:8080";
  }
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

// ── AI Identity (persisted in localStorage) ──────────────

type AIIdentity = {
  name: string;
  persona: string;
  platform: string;
  platformTarget: string;
  createdAt: number;
};

function getDefaultConnectorId(identity: AIIdentity) {
  return `${identity.name.toLowerCase().replace(/\s+/g, "-")}-mac`;
}

function loadIdentity(): AIIdentity | null {
  try {
    const raw = localStorage.getItem("ai_identity");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveIdentity(id: AIIdentity) {
  localStorage.setItem("ai_identity", JSON.stringify(id));
}

function getSessionId() {
  let id = localStorage.getItem("demo_session");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("demo_session", id);
  }
  return id;
}

// ── Shared constants ─────────────────────────────────────

const PERSONA_OPTIONS: Record<string, { label: string; desc: string }> = {
  professional: { label: "专业顾问", desc: "正式、结构化、直接给出建议" },
  friendly_coach: { label: "贴心教练", desc: "友好、鼓励、用大白话沟通" },
  no_bs: { label: "直言不讳", desc: "简洁、直接、不说废话" },
  playful_nerd: { label: "极客玩家", desc: "有趣、用比喻，但信息准确" },
};

// Two-axis persona mapping: tone (casual/formal) x mode (confirm/immediate)
function resolvePersona(tone: "casual" | "formal", mode: "confirm" | "immediate"): string {
  if (tone === "casual" && mode === "confirm") return "friendly_coach";
  if (tone === "casual" && mode === "immediate") return "playful_nerd";
  if (tone === "formal" && mode === "confirm") return "professional";
  if (tone === "formal" && mode === "immediate") return "no_bs";
  return "professional";
}

const PLATFORMS = [
  { id: "wechat", label: "微信", target: "#wechat" },
  { id: "imessage", label: "iMessage", target: "#imessage" },
  { id: "sms", label: "手机短信", target: "#sms" },
  { id: "wecom", label: "企业微信", target: "#wecom-team" },
  { id: "dingtalk", label: "钉钉", target: "#dingtalk-group" },
  { id: "feishu", label: "飞书", target: "#feishu-group" },
];

// ── Suggested Actions ────────────────────────────────

type SuggestedAction = {
  tool: string;
  label: string;
  args: Record<string, any>;
};

// ── Conversation History Types ───────────────────────────

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type Conversation = {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
};

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
  const cleaned = firstMessage.replace(/\n/g, " ").trim();
  return cleaned.length > 20 ? cleaned.substring(0, 20) + "..." : cleaned;
}

// ── Setup Screen ─────────────────────────────────────────

function ToggleSwitch({ value, onChange, labelA, labelB }: { value: boolean; onChange: (v: boolean) => void; labelA: string; labelB: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#F3F4F6",
        borderRadius: 24,
        padding: 3,
        cursor: "pointer",
        userSelect: "none",
      }}
      onClick={() => onChange(!value)}
    >
      <div
        style={{
          padding: "6px 16px",
          borderRadius: 20,
          fontSize: 13,
          fontWeight: !value ? 600 : 400,
          background: !value ? "white" : "transparent",
          color: !value ? "#4F46E5" : "#6B7280",
          boxShadow: !value ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
          transition: "all 0.2s",
        }}
      >
        {labelA}
      </div>
      <div
        style={{
          padding: "6px 16px",
          borderRadius: 20,
          fontSize: 13,
          fontWeight: value ? 600 : 400,
          background: value ? "white" : "transparent",
          color: value ? "#4F46E5" : "#6B7280",
          boxShadow: value ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
          transition: "all 0.2s",
        }}
      >
        {labelB}
      </div>
    </div>
  );
}

function SetupScreen({ onComplete }: { onComplete: (id: AIIdentity) => void }) {
  const [name, setName] = useState("");
  const [tone, setTone] = useState<"casual" | "formal">("casual");
  const [mode, setMode] = useState<"confirm" | "immediate">("confirm");
  const [platform, setPlatform] = useState("wechat");

  const persona = resolvePersona(tone, mode);

  const submit = () => {
    if (!name.trim()) return;
    const plat = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];
    const identity: AIIdentity = {
      name: name.trim(),
      persona,
      platform: plat.id,
      platformTarget: plat.target,
      createdAt: Date.now(),
    };
    saveIdentity(identity);
    onComplete(identity);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: "40px 36px",
          width: 440,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, textAlign: "center" }}>
          创建你的 AI 助手
        </h1>
        <p
          style={{
            textAlign: "center",
            color: "#6B7280",
            fontSize: 14,
            marginTop: 8,
            marginBottom: 32,
          }}
        >
          从第一天起，这个 AI 就是你的。
        </p>

        {/* AI Name */}
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              display: "block",
              fontWeight: 600,
              marginBottom: 6,
              fontSize: 14,
            }}
          >
            给你的 AI 起个名字
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：小助、阿智、团队管家…"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #D1D5DB",
              fontSize: 15,
              outline: "none",
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>

        {/* Two-Axis Personality */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
            个性设置
          </label>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>语气风格</div>
            <ToggleSwitch
              value={tone === "formal"}
              onChange={(v) => setTone(v ? "formal" : "casual")}
              labelA="轻松随意"
              labelB="正式专业"
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>执行模式</div>
            <ToggleSwitch
              value={mode === "immediate"}
              onChange={(v) => setMode(v ? "immediate" : "confirm")}
              labelA="先确认再执行"
              labelB="立即执行"
            />
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#9CA3AF" }}>
            Style: {PERSONA_OPTIONS[persona]?.label} — {PERSONA_OPTIONS[persona]?.desc}
          </div>
        </div>

        {/* Platform */}
        <div style={{ marginBottom: 32 }}>
          <label
            style={{
              display: "block",
              fontWeight: 600,
              marginBottom: 8,
              fontSize: 14,
            }}
          >
            你用什么平台？
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PLATFORMS.map((p) => (
              <div
                key={p.id}
                onClick={() => setPlatform(p.id)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 20,
                  border:
                    platform === p.id
                      ? "2px solid #4F46E5"
                      : "1px solid #E5E7EB",
                  background: platform === p.id ? "#EEF2FF" : "white",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: platform === p.id ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                {p.label}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 10,
            border: "none",
            background: name.trim() ? "#4F46E5" : "#D1D5DB",
            color: "white",
            fontWeight: 700,
            fontSize: 16,
            cursor: name.trim() ? "pointer" : "not-allowed",
            transition: "background 0.2s",
          }}
        >
          开始使用
        </button>
      </div>
    </div>
  );
}

// ── Phase stepper ────────────────────────────────────────

type Phase = "idle" | "planning" | "planned" | "executing" | "done" | "clarifying";

const PHASE_STEPS: { key: Phase; label: string }[] = [
  { key: "idle", label: "输入指令" },
  { key: "planning", label: "生成方案" },
  { key: "planned", label: "审批方案" },
  { key: "executing", label: "执行中" },
  { key: "done", label: "完成" },
];

function PhaseBar({ phase }: { phase: Phase }) {
  // Map "clarifying" to "planning" index for display purposes
  const displayPhase = phase === "clarifying" ? "planning" : phase;
  const currentIdx = PHASE_STEPS.findIndex((s) => s.key === displayPhase);

  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
      {PHASE_STEPS.map((s, i) => (
        <div
          key={s.key}
          style={{
            flex: 1,
            textAlign: "center",
            padding: "8px 0",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: i === currentIdx ? 700 : 400,
            color: i <= currentIdx ? "white" : "#9CA3AF",
            background:
              i < currentIdx
                ? "#059669"
                : i === currentIdx
                  ? "#4F46E5"
                  : "#F3F4F6",
            transition: "all 0.3s",
          }}
        >
          {s.label}
        </div>
      ))}
    </div>
  );
}

// ── App entry point ──────────────────────────────────────

export default function App() {
  const [identity, setIdentity] = useState<AIIdentity | null>(loadIdentity());
  const [authSession, setAuthSession] = useState<{ accessToken: string; userId: string } | null>(() => {
    try {
      const raw = localStorage.getItem("auth_session");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  // If Supabase auth is enabled but user isn't logged in, show auth screen
  if (isAuthEnabled() && !authSession) {
    return (
      <AuthScreen
        onAuth={(session) => {
          localStorage.setItem("auth_session", JSON.stringify(session));
          setAuthSession(session);
        }}
      />
    );
  }

  if (!identity) {
    return <SetupScreen onComplete={setIdentity} />;
  }

  return (
    <MainScreen
      identity={identity}
      accessToken={authSession?.accessToken}
      onReset={() => {
        localStorage.removeItem("ai_identity");
        localStorage.removeItem("demo_session");
        const keys = Object.keys(localStorage).filter((k) => k.startsWith("agent_meta_"));
        keys.forEach((k) => localStorage.removeItem(k));
        setIdentity(null);
      }}
      onLogout={isAuthEnabled() ? () => {
        localStorage.removeItem("auth_session");
        setAuthSession(null);
      } : undefined}
    />
  );
}

// ── Main screen ──────────────────────────────────────────

function MainScreen({
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
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [finalMsg, setFinalMsg] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [wsClient, setWsClient] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [approvedPermissions, setApprovedPermissions] = useState<Set<string>>(new Set());
  const connectorStorageKey = useMemo(() => `connector_id_${sessionId}`, [sessionId]);
  const [connectorId, setConnectorId] = useState<string>(() => {
    const stored = localStorage.getItem(`connector_id_${getSessionId()}`);
    return stored || getDefaultConnectorId(identity);
  });
  const [connectorOnline, setConnectorOnline] = useState(false);
  const [actionMode, setActionMode] = useState<"confirm" | "immediate">(() => {
    return (localStorage.getItem("action_mode") as any) || "confirm";
  });
  const [tone, setTone] = useState<"casual" | "formal">(() => {
    return (localStorage.getItem("tone_pref") as any) || (
      identity.persona === "friendly_coach" || identity.persona === "playful_nerd" ? "casual" : "formal"
    );
  });
  const [stepSummary, setStepSummary] = useState<Array<{ tool: string; status: string; description?: string }>>([]);
  const [completionStatus, setCompletionStatus] = useState<"success" | "partial" | "error" | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([]);
  const uploadedFileStorageKey = useMemo(() => `uploaded_file_${sessionId}`, [sessionId]);
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [showManualAddressFallback, setShowManualAddressFallback] = useState(false);
  const [manualFallbackReason, setManualFallbackReason] = useState("");
  const [agentMeta, setAgentMeta] = useState<AgentMeta>(() => loadMeta(metaStorageKey));
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [lastGainXp, setLastGainXp] = useState(0);

  // Conversation history state
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showHistorySidebar, setShowHistorySidebar] = useState(false);

  // Get current conversation
  const currentConversation = useMemo(() => {
    return conversations.find(c => c.id === currentConversationId) || null;
  }, [conversations, currentConversationId]);

  // Auto-cleanup old uploaded PDFs on page load
  useEffect(() => {
    const oldFileId = localStorage.getItem(uploadedFileStorageKey);
    if (oldFileId) {
      // Delete old file from server
      const apiBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
      fetch(`${apiBase}/upload/${oldFileId}`, { method: "DELETE" })
        .then(() => console.log(`[cleanup] Deleted old PDF: ${oldFileId}`))
        .catch((e) => console.warn(`[cleanup] Failed to delete old PDF:`, e));
      localStorage.removeItem(uploadedFileStorageKey);
    }
  }, [uploadedFileStorageKey]);
  const [rewardedRunIds, setRewardedRunIds] = useState<Set<string>>(new Set());
  const [showAPISettings, setShowAPISettings] = useState(false);

  useEffect(() => {
    setAgentMeta(loadMeta(metaStorageKey));
  }, [metaStorageKey]);

  const applyProgressEvent = (eventType: AgentEventType) => {
    setAgentMeta((prev) => {
      const result = applyEvent(prev, eventType);
      if (result.gainedXp > 0) {
        setLastGainXp(result.gainedXp);
      }
      saveMeta(metaStorageKey, result.next);
      return result.next;
    });
  };

  const handleSetColor = (color: string) => {
    setAgentMeta((prev) => {
      const next = { ...prev, color };
      saveMeta(metaStorageKey, next);
      return next;
    });
  };

  const handleEquip = (slot: CosmeticSlot, cosmeticId: string) => {
    setAgentMeta((prev) => {
      const next = equipCosmetic(prev, slot, cosmeticId);
      saveMeta(metaStorageKey, next);
      return next;
    });
  };

  const handleSetCustomAsset = (slot: CosmeticSlot, asset: string) => {
    setAgentMeta((prev) => {
      const next = setCustomCosmeticAsset(prev, slot, asset);
      saveMeta(metaStorageKey, next);
      return next;
    });
  };

  useEffect(() => {
    if (!connected) {
      setAvatarState("sleep");
      return;
    }
    if (phase === "planning" || phase === "executing") {
      setAvatarState("thinking");
      return;
    }
    if (phase === "clarifying") {
      setAvatarState("focused");
      return;
    }
    if (phase === "done") {
      setAvatarState("success");
      const timer = setTimeout(() => setAvatarState("idle"), 1500);
      return () => clearTimeout(timer);
    }
    if (phase === "planned") {
      setAvatarState("focused");
      return;
    }
    setAvatarState("idle");
  }, [phase, connected]);

  // ── WebSocket setup ──────────────────────────────────
  useEffect(() => {
    const wsUrl = getWebSocketURL(accessToken);
    const client = createWS(wsUrl, (m: EventMsg) => {
      if (m.type === "event") {
        const ev = m.event ?? "";
        const data = m.data;

        if (ev === "gateway.ready") setConnected(true);

        if (ev === "connector.status") {
          setConnectorOnline(!!data?.connected);
        }

        if (ev === "agent.plan.proposed") {
          setPlan(data);
          setPhase("planned");
        }

        if (ev === "agent.clarify") {
          setClarifyQuestion(data?.question ?? "请提供更多细节");
          setClarifyAnswer("");
          setPhase("clarifying");
        }

        if (ev === "agent.plan.error") {
          setPhase("idle");
          setAvatarState("error");
          setTimeout(() => setAvatarState("idle"), 1200);
        }

        if (ev.startsWith("agent.exec") || ev.startsWith("tool.")) {
          setLogs((prev) => [...prev, { ts: Date.now(), ev, data }]);
        }

        if (ev === "tool.start") {
          setAvatarState("thinking");
        }

        if (ev === "tool.success") {
          applyProgressEvent("tool_used");
          setAvatarState("focused");
          // Capture any suggestedActions the tool returned
          const actions = data?.result?.suggestedActions;
          if (Array.isArray(actions) && actions.length > 0) {
            console.log("[app] suggestedActions received:", actions);
            setSuggestedActions(actions);
          }
        }

        if (ev === "tool.error") {
          const toolId = String(data?.tool ?? "");
          const errorText = String(data?.error ?? "");
          const shouldAskManualAddress =
            toolId === "contacts.apple" ||
            (toolId === "imessage.send" &&
              /无法获取联系人信息|requires a handle|\[missing:|\[error:/i.test(errorText));

          if (shouldAskManualAddress) {
            setShowManualAddressFallback(true);
            setManualFallbackReason(errorText || "联系人查找失败，请手动输入地址");
          }
        }

        if (ev === "agent.exec.started") setPhase("executing");

        if (ev === "tool.success") {
          setStepSummary((prev) => [...prev, {
            tool: data?.tool ?? "unknown",
            status: "ok",
            description: data?.description,
          }]);
        }

        if (ev === "tool.error") {
          setStepSummary((prev) => [...prev, {
            tool: data?.tool ?? "unknown",
            status: "error",
            description: data?.error,
          }]);
        }

        if (ev === "agent.exec.finished") {
          const steps = data?.steps ?? [];
          const hasErrors = steps.some((s: any) => s.status === "error");
          const allErrors = steps.length > 0 && steps.every((s: any) => s.status === "error");
          setCompletionStatus(allErrors ? "error" : hasErrors ? "partial" : "success");
        }

        if (ev === "agent.rendered") {
          setFinalMsg(data.message);
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
          
          // Browser notification
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            new Notification("Alfred 阿福", { body: "任务已完成！" });
          }
          const thisRunId = data?.runId as string | undefined;
          if (thisRunId) {
            let shouldReward = false;
            setRewardedRunIds((prev) => {
              if (prev.has(thisRunId)) return prev;
              shouldReward = true;
              const next = new Set(prev);
              next.add(thisRunId);
              return next;
            });
            if (shouldReward) {
              applyProgressEvent("task_completed");
            }
          }
        }
      } else {
        if (m.result?.planId) setPlanId(m.result.planId);
        if (m.result?.runId) setRunId(m.result.runId);
        if (m.result?.connectorId) {
          setConnectorOnline(!!m.result.connected);
        }
      }
    });

    setWsClient(client);
  }, []);

  // Set persona on connect
  useEffect(() => {
    if (!wsClient) return;
    wsClient.call("session.setPersona", {
      sessionId,
      persona: identity.persona,
    });
  }, [wsClient, sessionId, identity.persona]);

  // Auto-sync API settings to backend on connect
  useEffect(() => {
    if (!connected) return;
    const config = loadAPIConfig();
    // Only sync if user has configured an API key
    if (config.geminiKey || config.anthropicKey || config.qwenKey) {
      const apiBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
      fetch(`${apiBase}/api/settings`, {
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

  useEffect(() => {
    localStorage.setItem(connectorStorageKey, connectorId);
  }, [connectorStorageKey, connectorId]);

  useEffect(() => {
    if (!wsClient) return;
    const id = connectorId.trim();
    if (!id) return;

    wsClient.call("session.bindConnector", {
      sessionId,
      connectorId: id,
    });
  }, [wsClient, sessionId, connectorId]);

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

  const startNewConversation = () => {
    setPhase("idle");
    setPrompt("");
    setPlan(null);
    setFinalMsg("");
    setStepSummary([]);
    setCurrentConversationId(null);
  };

  const switchToConversation = (convId: string) => {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    
    setCurrentConversationId(convId);
    setShowHistorySidebar(false);
    
    const lastAssistantMsg = [...conv.messages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg) {
      setFinalMsg(lastAssistantMsg.content);
      setPhase("done");
    } else {
      setPhase("idle");
      setFinalMsg("");
    }
    
    setPrompt("");
    setPlan(null);
    setStepSummary([]);
  };

  const deleteConversation = (convId: string) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== convId);
      saveConversations(updated);
      return updated;
    });
    if (currentConversationId === convId) {
      setCurrentConversationId(null);
      setPhase("idle");
      setFinalMsg("");
    }
  };

  const startPlanning = (nextPrompt: string) => {
    if (!wsClient || !nextPrompt.trim()) return;
    
    let finalPrompt = nextPrompt;
    
    // Include conversation history for context
    if (currentConversation && currentConversation.messages.length > 0) {
      const historyContext = currentConversation.messages
        .slice(-6)
        .map(m => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
        .join("\n\n");
      finalPrompt = `[对话历史]\n${historyContext}\n\n[当前请求]\n${nextPrompt}`;
    }
    
    // If a PDF was uploaded, append file reference to the prompt
    if (uploadedFileId) {
      finalPrompt = `${finalPrompt}\n\n[Attached file: ${uploadedFileId}]`;
    }
    
    // Save user message to conversation
    addMessageToConversation("user", nextPrompt);
    
    setLogs([]);
    setFinalMsg("");
    setRunId(null);
    setPlanId(null);
    setPlan(null);
    setApprovedPermissions(new Set());
    setShowManualAddressFallback(false);
    setManualFallbackReason("");
    setSuggestedActions([]);
    setStepSummary([]);
    setCompletionStatus(null);
    setPhase("planning");
    setLastGainXp(0);

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

  const retryWithManualAddress = () => {
    const address = manualAddress.trim();
    if (!address) return;
    const mergedPrompt = `${prompt.trim()}\n收件人地址：${address}`;
    setPrompt(mergedPrompt);
    startPlanning(mergedPrompt);
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
  const allPermsApproved =
    requiredPerms.length === 0 ||
    requiredPerms.every((p: string) => approvedPermissions.has(p));

  const approve = () => {
    if (!wsClient || !planId || !allPermsApproved) return;
    wsClient.call("agent.execute", { sessionId, planId, approved: true });
  };

  const rewrite = (p: string) => {
    if (!wsClient || !runId) return;
    wsClient.call("agent.render", { sessionId, runId, persona: p });
  };

  const toggleActionMode = () => {
    const next = actionMode === "confirm" ? "immediate" : "confirm";
    setActionMode(next);
    localStorage.setItem("action_mode", next);
    if (wsClient) {
      wsClient.call("session.setActionMode", { sessionId, mode: next });
      // Also update persona based on new mode + current tone
      const newPersona = resolvePersona(tone, next);
      wsClient.call("session.setPersona", { sessionId, persona: newPersona });
    }
  };

  const toggleTone = () => {
    const next = tone === "casual" ? "formal" : "casual";
    setTone(next);
    localStorage.setItem("tone_pref", next);
    if (wsClient) {
      const newPersona = resolvePersona(next, actionMode);
      wsClient.call("session.setPersona", { sessionId, persona: newPersona });
    }
  };

  // Request notification permission on mount
  React.useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Sync action mode on WS connect
  useEffect(() => {
    if (!wsClient) return;
    wsClient.call("session.setActionMode", { sessionId, mode: actionMode });
  }, [wsClient, sessionId, actionMode]);

  const submitClarification = () => {
    if (!wsClient || !clarifyAnswer.trim()) return;
    setPhase("planning");
    wsClient.call("agent.clarify.response", { sessionId, answer: clarifyAnswer.trim() });
    setClarifyQuestion("");
    setClarifyAnswer("");
  };

  // ── Derived ──────────────────────────────────────────
  const platLabel =
    PLATFORMS.find((p) => p.id === identity.platform)?.label ?? identity.platform;
  const personaInfo = PERSONA_OPTIONS[identity.persona];

  return (
    <div
      style={{
        fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
        background: "#F9FAFB",
        minHeight: "100vh",
      }}
    >
      {/* ── Header ──────────────────────────────────────── */}
      <header
        style={{
          background: "white",
          borderBottom: "1px solid #E5E7EB",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Avatar */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #4F46E5, #7C3AED)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: 700,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {identity.name[0]}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{identity.name}</div>
            <div style={{ fontSize: 12, color: "#6B7280" }}>
              {personaInfo?.label ?? identity.persona} · {platLabel}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Locality badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 20,
              background: connected ? "#ECFDF5" : "#FEF2F2",
              color: connected ? "#059669" : "#DC2626",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: connected ? "#059669" : "#DC2626",
                display: "inline-block",
              }}
            />
            {connected ? "已连接" : "未连接"}
          </div>

          {/* Tone toggle */}
          <div
            onClick={toggleTone}
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              background: tone === "formal" ? "#EEF2FF" : "#F0FDF4",
              fontSize: 12,
              color: tone === "formal" ? "#4338CA" : "#166534",
              cursor: "pointer",
              userSelect: "none",
              fontWeight: 500,
            }}
            title="Toggle tone"
          >
            {tone === "casual" ? "轻松" : "正式"}
          </div>

          {/* Action mode toggle */}
          <div
            onClick={toggleActionMode}
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              background: actionMode === "immediate" ? "#FEF3C7" : "#F3F4F6",
              fontSize: 12,
              color: actionMode === "immediate" ? "#92400E" : "#6B7280",
              cursor: "pointer",
              userSelect: "none",
              fontWeight: 500,
            }}
            title="Toggle action mode"
          >
            {actionMode === "confirm" ? "确认模式" : "立即执行"}
          </div>

          {/* Model badge */}
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              background: "#F3F4F6",
              fontSize: 12,
              color: "#6B7280",
            }}
          >
            Alfred 阿福
          </div>

          <button
            onClick={onReset}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #E5E7EB",
              background: "white",
              fontSize: 12,
              color: "#6B7280",
              cursor: "pointer",
            }}
          >
            重新设置
          </button>

          <button
            onClick={() => setShowAPISettings(true)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #3B82F6",
              background: "#EFF6FF",
              fontSize: 12,
              color: "#3B82F6",
              cursor: "pointer",
            }}
          >
            API 配置
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid #FCA5A5",
                background: "#FEF2F2",
                fontSize: 12,
                color: "#DC2626",
                cursor: "pointer",
              }}
            >
              登出
            </button>
          )}

          {/* History button */}
          <button
            onClick={() => setShowHistorySidebar(true)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #E5E7EB",
              background: "white",
              fontSize: 12,
              color: "#6B7280",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v4l3 3"/>
              <circle cx="12" cy="12" r="9"/>
            </svg>
            对话历史
          </button>
        </div>
      </header>

      {/* API Settings Modal */}
      <APISettings
        isOpen={showAPISettings}
        onClose={() => setShowAPISettings(false)}
        onSave={(config) => {
          console.log("[app] API settings saved:", config.llmProvider);
        }}
      />

      {/* ── Main content ────────────────────────────────── */}
      <div style={{ maxWidth: 1020, margin: "0 auto", padding: "20px 24px" }}>
        <PhaseBar phase={phase} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          {/* ── Left: Input + Plan ──────────────────────── */}
          <div>
            {/* Prompt input card */}
            <div
              style={{
                background: "white",
                borderRadius: 12,
                border: "1px solid #E5E7EB",
                padding: 20,
                marginBottom: 16,
              }}
            >
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: 8,
                  fontSize: 14,
                }}
              >
                告诉{identity.name}你想做什么
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="例如：帮我给Adam发消息约周五晚上8点吃饭…"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #D1D5DB",
                  fontFamily: "inherit",
                  fontSize: 14,
                  resize: "vertical",
                  outline: "none",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey) askPlan();
                }}
              />

              {/* PDF Upload */}
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                      background: "white",
                      fontSize: 12,
                      cursor: "pointer",
                      color: "#6B7280",
                    }}
                  >
                    上传 PDF
                    <input
                      type="file"
                      accept=".pdf"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const fd = new FormData();
                        fd.append("file", file);
                        try {
                          const apiBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
                          const res = await fetch(`${apiBase}/upload`, { method: "POST", body: fd });
                          const json = await res.json();
                          if (json.fileId) {
                            setUploadedFileId(json.fileId);
                            localStorage.setItem(uploadedFileStorageKey, json.fileId);
                          }
                        } catch (err) {
                          console.error("Upload failed:", err);
                        }
                      }}
                    />
                  </label>
                  {uploadedFileId && (
                    <>
                      <span style={{ fontSize: 12, color: "#059669" }}>
                        已上传: {uploadedFileId}
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            const apiBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
                            await fetch(`${apiBase}/upload/${uploadedFileId}`, { method: "DELETE" });
                            setUploadedFileId(null);
                            localStorage.removeItem(uploadedFileStorageKey);
                          } catch (err) {
                            console.error("Delete failed:", err);
                          }
                        }}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: "1px solid #E5E7EB",
                          background: "white",
                          fontSize: 12,
                          cursor: "pointer",
                          color: "#DC2626",
                        }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: 600,
                    marginBottom: 6,
                    fontSize: 12,
                    color: "#6B7280",
                  }}
                >
                  本机 Connector ID（用于调用本地工具）
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={connectorId}
                    onChange={(e) => {
                      setConnectorOnline(false);
                      setConnectorId(e.target.value);
                    }}
                    placeholder="例如：rae-mac"
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #D1D5DB",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => {
                      if (!wsClient || !connectorId.trim()) return;
                      wsClient.call("session.bindConnector", {
                        sessionId,
                        connectorId: connectorId.trim(),
                      });
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                      background: "white",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    绑定
                  </button>
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: connectorOnline ? "#059669" : "#9CA3AF",
                  }}
                >
                  {connectorOnline
                    ? `Connector 已在线：${connectorId}`
                    : "Connector 未连接（通讯录/iMessage/微信需要本机 Connector）"}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <button
                  onClick={askPlan}
                  disabled={!prompt.trim() || phase === "planning"}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: "none",
                    background:
                      prompt.trim() && phase !== "planning"
                        ? "#4F46E5"
                        : "#D1D5DB",
                    color: "white",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor:
                      prompt.trim() && phase !== "planning"
                        ? "pointer"
                        : "not-allowed",
                    transition: "background 0.2s",
                  }}
                >
                  {phase === "planning" ? "方案生成中…" : "生成方案"}
                </button>

                {phase === "planned" && (
                  <button
                    onClick={approve}
                    disabled={!allPermsApproved}
                    style={{
                      flex: 1,
                      padding: "10px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: allPermsApproved ? "#059669" : "#D1D5DB",
                      color: "white",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: allPermsApproved ? "pointer" : "not-allowed",
                      transition: "background 0.2s",
                    }}
                  >
                    {allPermsApproved
                      ? "批准并执行"
                      : `请先授权 (${requiredPerms.length - approvedPermissions.size} 项)`}
                  </button>
                )}
              </div>

              {/* Clarification dialog */}
              {phase === "clarifying" && clarifyQuestion && (
                <div
                  style={{
                    marginTop: 12,
                    background: "#EEF2FF",
                    borderRadius: 8,
                    padding: 12,
                    border: "1px solid #C7D2FE",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#4338CA",
                      marginBottom: 8,
                    }}
                  >
                    {identity.name} 需要确认
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#1E1B4B",
                      marginBottom: 10,
                    }}
                  >
                    {clarifyQuestion}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={clarifyAnswer}
                      onChange={(e) => setClarifyAnswer(e.target.value)}
                      placeholder="输入你的回答…"
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #C7D2FE",
                        fontSize: 13,
                        outline: "none",
                      }}
                      onKeyDown={(e) => e.key === "Enter" && submitClarification()}
                    />
                    <button
                      onClick={submitClarification}
                      disabled={!clarifyAnswer.trim()}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: "none",
                        background: clarifyAnswer.trim() ? "#4F46E5" : "#D1D5DB",
                        color: "white",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: clarifyAnswer.trim() ? "pointer" : "not-allowed",
                      }}
                    >
                      确认
                    </button>
                  </div>
                </div>
              )}

              {showManualAddressFallback && (
                <div
                  style={{
                    marginTop: 12,
                    background: "#FEF3C7",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#92400E",
                      marginBottom: 6,
                    }}
                  >
                    联系人查找失败，请手动输入地址继续
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#78350F",
                      marginBottom: 8,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {manualFallbackReason}
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={manualAddress}
                      onChange={(e) => setManualAddress(e.target.value)}
                      placeholder="输入地址（手机号或邮箱）"
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #D1D5DB",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={retryWithManualAddress}
                      disabled={!manualAddress.trim()}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "none",
                        background: manualAddress.trim() ? "#4F46E5" : "#D1D5DB",
                        color: "white",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: manualAddress.trim() ? "pointer" : "not-allowed",
                      }}
                    >
                      用地址重试
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Plan card */}
            <ProposedPlan
              plan={plan}
              approvedPermissions={approvedPermissions}
              onTogglePermission={togglePermission}
            />
          </div>

          {/* ── Right: Execution + Response ─────────────── */}
          <div>
            <AgentAvatarCard
              agentName={identity.name}
              meta={agentMeta}
              state={avatarState}
              lastGainXp={lastGainXp}
              onSetColor={handleSetColor}
              onEquip={handleEquip}
              onSetCustomAsset={handleSetCustomAsset}
              onPositiveFeedback={() => applyProgressEvent("user_feedback_positive")}
              onShareResult={() => applyProgressEvent("shared_result")}
            />
            <ExecutionLog logs={logs} />
            <FinalAnswer message={finalMsg} status={completionStatus} stepSummary={stepSummary} />

            {/* Suggested action buttons — rendered after tool results come in */}
            {suggestedActions.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  background: "white",
                  borderRadius: 12,
                  border: "1px solid #C7D2FE",
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 10,
                    color: "#4338CA",
                  }}
                >
                  下一步可以：
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {suggestedActions.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (!wsClient) return;
                        console.log("[app] action button clicked:", action.label, action.tool, action.args);
                        setSuggestedActions([]);
                        setLogs([]);
                        setFinalMsg("");
                        setStepSummary([]);
                        setCompletionStatus(null);
                        setPhase("executing");
                        console.log("[app] triggering tool via agent.run_action:", action.tool);
                        wsClient.call("agent.run_action", {
                          sessionId,
                          tool: action.tool,
                          args: action.args,
                          label: action.label,
                        });
                      }}
                      style={{
                        padding: "8px 18px",
                        borderRadius: 20,
                        border: "1px solid #818CF8",
                        background: "#EEF2FF",
                        color: "#4338CA",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseOver={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "#4338CA";
                        (e.currentTarget as HTMLButtonElement).style.color = "white";
                      }}
                      onMouseOut={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "#EEF2FF";
                        (e.currentTarget as HTMLButtonElement).style.color = "#4338CA";
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Persona rewrite buttons — only after done */}
            {phase === "done" && (
              <div
                style={{
                  marginTop: 16,
                  background: "white",
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 10,
                    color: "#6B7280",
                  }}
                >
                  换个风格试试
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(PERSONA_OPTIONS).map(([key, { label }]) => (
                    <button
                      key={key}
                      onClick={() => rewrite(key)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 20,
                        border: "1px solid #E5E7EB",
                        background:
                          key === identity.persona ? "#EEF2FF" : "white",
                        fontSize: 13,
                        cursor: "pointer",
                        fontWeight: key === identity.persona ? 600 : 400,
                        transition: "all 0.15s",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Followup input */}
                <div style={{ marginTop: 16, borderTop: "1px solid #E5E7EB", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#6B7280" }}>
                    继续对话
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="继续提问..."
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #D1D5DB",
                        fontSize: 14,
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && prompt.trim()) askPlan();
                      }}
                    />
                    <button
                      onClick={askPlan}
                      disabled={!prompt.trim() || !connected}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 8,
                        border: "none",
                        background: prompt.trim() && connected ? "#4F46E5" : "#D1D5DB",
                        color: "white",
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: prompt.trim() && connected ? "pointer" : "not-allowed",
                      }}
                    >
                      发送
                    </button>
                    <button
                      onClick={startNewConversation}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 8,
                        border: "1px solid #E5E7EB",
                        background: "white",
                        color: "#6B7280",
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      新对话
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
          <div
            onClick={() => setShowHistorySidebar(false)}
            style={{
              flex: 1,
              background: "rgba(0,0,0,0.4)",
            }}
          />
          <div
            style={{
              width: 320,
              background: "white",
              boxShadow: "-4px 0 20px rgba(0,0,0,0.1)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
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

            <button
              onClick={() => {
                startNewConversation();
                setShowHistorySidebar(false);
              }}
              style={{
                margin: "16px 20px",
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

            <div style={{ flex: 1, overflowY: "auto", padding: "0 12px" }}>
              {conversations.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>
                  暂无对话记录
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    style={{
                      padding: "14px",
                      marginBottom: 8,
                      borderRadius: 10,
                      background: conv.id === currentConversationId ? "#EEF2FF" : "#F9FAFB",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      transition: "all 0.15s",
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
                      <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>
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
                        fontSize: 13,
                        cursor: "pointer",
                        padding: "6px 10px",
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
