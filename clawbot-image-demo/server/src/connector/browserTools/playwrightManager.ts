/**
 * Playwright Session Manager
 * 
 * Manages browser instances and page sessions for reuse across tasks.
 * 
 * Design principles:
 * - Single browser instance shared across all sessions
 * - Sessions can be reused (page stays open between tasks)
 * - Idle sessions are cleaned up after timeout
 * - Pages are NOT closed automatically after tasks
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";

// ── Configuration ────────────────────────────────────────

const BROWSER_OPTIONS = {
  headless: false,  // Show browser so user can see actions
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
  ],
};

const CONTEXT_OPTIONS = {
  viewport: { width: 1280, height: 800 },
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  locale: "en-US",
};

/** Idle timeout before session cleanup (5 minutes) */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Cleanup check interval (1 minute) */
const CLEANUP_INTERVAL_MS = 60 * 1000;

// ── Types ────────────────────────────────────────────────

export interface BrowserSession {
  id: string;
  context: BrowserContext;
  page: Page;
  lastActivity: number;
  state: "active" | "idle" | "closed";
}

// ── State ────────────────────────────────────────────────

let browser: Browser | null = null;
const sessions = new Map<string, BrowserSession>();
let cleanupTimer: NodeJS.Timeout | null = null;

// ── Browser Lifecycle ────────────────────────────────────

/**
 * Get or create the shared browser instance.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    console.log("[playwright] Launching browser...");
    browser = await chromium.launch(BROWSER_OPTIONS);
    console.log("[playwright] Browser launched");
    
    // Start cleanup timer
    startCleanupTimer();
  }
  return browser;
}

// ── Session Management ───────────────────────────────────

/**
 * Get or create a session with the given ID.
 * 
 * @param sessionId - Session identifier (default: "default")
 * @returns Browser session with context and page
 */
export async function getOrCreateSession(sessionId: string = "default"): Promise<BrowserSession> {
  // Check for existing session
  const existing = sessions.get(sessionId);
  if (existing && existing.state !== "closed") {
    existing.lastActivity = Date.now();
    existing.state = "active";
    console.log(`[playwright] Reusing session: ${sessionId}`);
    return existing;
  }
  
  // Create new session
  console.log(`[playwright] Creating session: ${sessionId}`);
  const b = await getBrowser();
  const context = await b.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();
  
  const session: BrowserSession = {
    id: sessionId,
    context,
    page,
    lastActivity: Date.now(),
    state: "active",
  };
  
  sessions.set(sessionId, session);
  console.log(`[playwright] Session created: ${sessionId}`);
  
  return session;
}

/**
 * Get the page for a session (convenience wrapper).
 * Creates session if it doesn't exist.
 * 
 * @param sessionId - Session identifier
 * @returns Playwright Page instance
 */
export async function getSessionPage(sessionId: string = "default"): Promise<Page> {
  const session = await getOrCreateSession(sessionId);
  return session.page;
}

/**
 * Get the page from the most recently active session (any session).
 * Used by browser.extract_page to operate on whatever page is currently open.
 *
 * Priority order: session with highest `lastActivity` timestamp.
 * Falls back to creating a new "default" session if none exist.
 *
 * @returns Playwright Page instance and the session ID that was used
 */
export async function getMostRecentSessionPage(): Promise<{ page: Page; sessionId: string }> {
  let best: BrowserSession | null = null;

  for (const session of sessions.values()) {
    if (session.state !== "closed") {
      if (!best || session.lastActivity > best.lastActivity) {
        best = session;
      }
    }
  }

  if (best) {
    best.lastActivity = Date.now();
    best.state = "active";
    return { page: best.page, sessionId: best.id };
  }

  // No existing session — create a default one
  const session = await getOrCreateSession("default");
  return { page: session.page, sessionId: "default" };
}

/**
 * Mark a session as idle (available for reuse, subject to timeout cleanup).
 * Does NOT close the page — it stays open for debugging/reuse.
 * 
 * @param sessionId - Session identifier
 */
export function markSessionIdle(sessionId: string = "default"): void {
  const session = sessions.get(sessionId);
  if (session && session.state !== "closed") {
    session.lastActivity = Date.now();
    session.state = "idle";
    console.log(`[playwright] Session marked idle: ${sessionId}`);
  }
}

/**
 * Explicitly reset a session (close context and page, remove from pool).
 * 
 * @param sessionId - Session identifier
 */
export async function resetSession(sessionId: string = "default"): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  console.log(`[playwright] Resetting session: ${sessionId}`);
  
  session.state = "closed";
  
  try {
    await session.page.close().catch(() => {});
    await session.context.close().catch(() => {});
  } catch {
    // Ignore errors during cleanup
  }
  
  sessions.delete(sessionId);
  console.log(`[playwright] Session reset complete: ${sessionId}`);
}

// ── Cleanup ──────────────────────────────────────────────

/**
 * Clean up sessions that have been idle longer than the timeout.
 * 
 * @param maxIdleMs - Maximum idle time before cleanup (default: IDLE_TIMEOUT_MS)
 * @returns Number of sessions cleaned up
 */
export async function cleanupIdleSessions(maxIdleMs: number = IDLE_TIMEOUT_MS): Promise<number> {
  const now = Date.now();
  let cleanedUp = 0;
  
  for (const [sessionId, session] of sessions.entries()) {
    if (session.state === "idle" && now - session.lastActivity > maxIdleMs) {
      console.log(`[playwright] Cleaning up idle session: ${sessionId} (idle for ${Math.round((now - session.lastActivity) / 1000)}s)`);
      await resetSession(sessionId);
      cleanedUp++;
    }
  }
  
  // If no sessions left, close the browser
  if (sessions.size === 0 && browser) {
    console.log("[playwright] No active sessions, closing browser");
    await cleanupAll();
  }
  
  return cleanedUp;
}

/**
 * Full cleanup — close all sessions and the browser.
 */
export async function cleanupAll(): Promise<void> {
  console.log("[playwright] Cleaning up all sessions and browser...");
  
  stopCleanupTimer();
  
  // Close all sessions
  for (const sessionId of sessions.keys()) {
    await resetSession(sessionId);
  }
  
  // Close browser
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Ignore errors
    }
    browser = null;
  }
  
  console.log("[playwright] Cleanup complete");
}

// ── Cleanup Timer ────────────────────────────────────────

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  
  cleanupTimer = setInterval(async () => {
    try {
      await cleanupIdleSessions();
    } catch (e) {
      console.error("[playwright] Cleanup error:", e);
    }
  }, CLEANUP_INTERVAL_MS);
  
  // Don't block process exit
  cleanupTimer.unref();
}

function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ── Debug Utilities ──────────────────────────────────────

/**
 * Get current session status for debugging.
 */
export function getSessionStatus(): Record<string, { state: string; idleSeconds: number }> {
  const now = Date.now();
  const status: Record<string, { state: string; idleSeconds: number }> = {};
  
  for (const [id, session] of sessions.entries()) {
    status[id] = {
      state: session.state,
      idleSeconds: Math.round((now - session.lastActivity) / 1000),
    };
  }
  
  return status;
}

// ── Process Cleanup Handlers ─────────────────────────────

process.on("exit", () => {
  // Synchronous cleanup only
  stopCleanupTimer();
});

process.on("SIGINT", async () => {
  await cleanupAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanupAll();
  process.exit(0);
});
