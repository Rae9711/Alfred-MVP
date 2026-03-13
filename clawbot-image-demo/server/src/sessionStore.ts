import { nanoid } from "nanoid";
import { getSupabase } from "./db/supabase.js";

export type Persona =
  | "professional"
  | "friendly_coach"
  | "no_bs"
  | "playful_nerd";

export type ActionMode = "confirm" | "immediate";

type Session = {
  sessionId: string;
  userId?: string;
  persona: Persona;
  actionMode: ActionMode;
  prompt?: string;
  connectorId?: string;
  /** Stored context for multi-turn clarification */
  clarificationContext?: {
    originalPrompt: string;
    plannerInstruction?: string;
  };
};

/** Fire-and-forget upsert to Supabase */
function persistSession(s: Session) {
  const sb = getSupabase();
  if (!sb) return;
  sb.from("sessions")
    .upsert({
      session_id: s.sessionId,
      user_id: s.userId ?? null,
      persona: s.persona,
      action_mode: s.actionMode,
      prompt: s.prompt ?? null,
      connector_id: s.connectorId ?? null,
      clarification_context: s.clarificationContext ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id" })
    .then(({ error }) => {
      if (error) console.error("[supabase] persistSession error:", error.message);
    });
}

const sessions = new Map<string, Session>();

export function getSession(sessionId: string): Session {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      persona: "professional",
      actionMode: "confirm",
    });
  }
  return sessions.get(sessionId)!;
}

export function setUserId(sessionId: string, userId: string) {
  const s = getSession(sessionId);
  s.userId = userId;
  persistSession(s);
}

export function setPersona(sessionId: string, persona: string) {
  const s = getSession(sessionId);
  const p = (persona || "professional") as Persona;
  s.persona = p;
  persistSession(s);
}

export function setPrompt(sessionId: string, prompt: string) {
  const s = getSession(sessionId);
  s.prompt = prompt;
  persistSession(s);
}

export function getPrompt(sessionId: string): string | undefined {
  return getSession(sessionId).prompt;
}

export function bindConnector(sessionId: string, connectorId: string) {
  const s = getSession(sessionId);
  s.connectorId = (connectorId || "").trim() || undefined;
  persistSession(s);
}

export function getConnectorId(sessionId: string): string | undefined {
  return getSession(sessionId).connectorId;
}

export function setActionMode(sessionId: string, mode: ActionMode) {
  const s = getSession(sessionId);
  s.actionMode = mode === "immediate" ? "immediate" : "confirm";
  persistSession(s);
}

export function getActionMode(sessionId: string): ActionMode {
  return getSession(sessionId).actionMode;
}

export function setClarificationContext(
  sessionId: string,
  ctx: { originalPrompt: string; plannerInstruction?: string; saveAs?: string; clarifyStepId?: string },
) {
  const s = getSession(sessionId);
  s.clarificationContext = ctx;
  persistSession(s);
}

export function getClarificationContext(sessionId: string) {
  return getSession(sessionId).clarificationContext;
}

export function clearClarificationContext(sessionId: string) {
  const s = getSession(sessionId);
  s.clarificationContext = undefined;
  persistSession(s);
}

export function newSessionId() {
  return nanoid();
}
