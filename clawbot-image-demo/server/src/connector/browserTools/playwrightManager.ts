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

import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

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
let sharedContext: BrowserContext | null = null;
let lastBrowserLaunchTime = 0;

// ── Browser Lifecycle ────────────────────────────────────

/**
 * Get or create the shared browser instance.
 */
export async function getBrowser(): Promise<Browser> {
  try {
    const hasBrowser = !!browser;
    const connected = hasBrowser && typeof (browser as any).isConnected === "function" ? (browser as any).isConnected() : hasBrowser;

    if (!hasBrowser || !connected) {
      console.log("[playwright] No browser or disconnected — launching new browser instance...");
      browser = await chromium.launch(BROWSER_OPTIONS);
      lastBrowserLaunchTime = Date.now();
      console.log("[playwright] Browser launched");
      // Do NOT automatically close or null out sharedContext here; recreate below if needed
      if (sharedContext && (sharedContext as any).isClosed && (sharedContext as any).isClosed()) {
        sharedContext = null;
      }
      // Start cleanup timer if not running
      startCleanupTimer();
    } else {
      console.log("[playwright] Reusing existing browser instance (connected)");
    }
  } catch (e) {
    console.log('[playwright] getBrowser encountered error, launching fresh browser', e);
    browser = await chromium.launch(BROWSER_OPTIONS);
    lastBrowserLaunchTime = Date.now();
    sharedContext = null;
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
  if (existing) {
    // If session explicitly closed, recreate
    if (existing.state === "closed") {
      await resetSession(sessionId);
    } else {
      // If the page or context was closed externally, reset and recreate
      try {
        const pageClosed = existing.page?.isClosed ? existing.page.isClosed() : false;
        const ctxClosed = existing.context && (existing.context as any).isClosed ? (existing.context as any).isClosed() : false;
        console.log(`[playwright] Existing session check — session=${sessionId} page.isClosed=${pageClosed} context.isClosed=${ctxClosed}`);

        // If context is closed, force a full reset for this session
        if (ctxClosed) {
          console.log(`[playwright] Session context closed, resetting session: ${sessionId}`);
          await resetSession(sessionId);
        } else if (pageClosed) {
          // If the page is closed but context is still present, create a new page in same context
          console.log(`[playwright] Session page closed; creating new page in same context: ${sessionId}`);
          const ctx = existing.context ?? sharedContext;
          // If context is closed or missing, ensure we recreate shared context
          if (!ctx || ((ctx as any).isClosed && (ctx as any).isClosed())) {
            console.log(`[playwright] No live context available for session ${sessionId}, recreating shared context`);
            const b = await getBrowser();
            sharedContext = await b.newContext(CONTEXT_OPTIONS);
            existing.context = sharedContext;
          }
          if (existing.context) {
            const newPage = await existing.context.newPage();
            existing.page = newPage;
            existing.lastActivity = Date.now();
            existing.state = "active";
            console.log(`[playwright] Replaced closed page with new page for session: ${sessionId}`);
            return existing;
          }
          // If no context, reset to recreate everything
          await resetSession(sessionId);
        } else {
          existing.lastActivity = Date.now();
          existing.state = "active";
          console.log(`[playwright] Reusing session: ${sessionId}`);
          return existing;
        }
      } catch (e) {
        // If any error inspecting the page, reset and recreate
        console.log(`[playwright] Error checking session page, recreating: ${sessionId}`, e);
        await resetSession(sessionId);
      }
    }
  }
  
  // Create new session
  console.log(`[playwright] Creating session: ${sessionId}`);
  const b = await getBrowser();

  // Reuse a shared context when possible so we keep one browser window
  try {
    if (!sharedContext || ((sharedContext as any).isClosed && (sharedContext as any).isClosed())) {
      console.log(`[playwright] Creating shared browser context`);
      sharedContext = await b.newContext(CONTEXT_OPTIONS);
    } else {
      console.log(`[playwright] Reusing shared browser context`);
    }
  } catch (e) {
    console.log('[playwright] Error accessing sharedContext, creating new one', e);
    sharedContext = await b.newContext(CONTEXT_OPTIONS);
  }

  const context = sharedContext as BrowserContext;

  // Create a new tab/page in the shared context
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
  // Enforce strict invariants and provide diagnostic logs
  console.log(`[playwright] getSessionPage START — session=${sessionId}`);
  const session = await getOrCreateSession(sessionId);

  // Diagnostic snapshot
  const browserAlive = !!browser && (typeof (browser as any).isConnected !== "function" || (browser as any).isConnected());
  const contextAlive = !!session.context && !((session.context as any).isClosed && (session.context as any).isClosed());
  const pageExists = !!session.page;
  const pageClosed = pageExists && session.page.isClosed ? session.page.isClosed() : false;
  console.log(`[playwright] diagnostics — browserAlive=${browserAlive} contextAlive=${contextAlive} pageExists=${pageExists} pageClosed=${pageClosed}`);

  // Ensure browser exists and is connected
  if (!browserAlive) {
    console.log("[playwright] Browser missing or disconnected — recreating browser and shared context");
    const b = await getBrowser();
    // recreate sharedContext if missing
    if (!sharedContext || ((sharedContext as any).isClosed && (sharedContext as any).isClosed())) {
      sharedContext = await b.newContext(CONTEXT_OPTIONS);
      console.log("[playwright] Shared context recreated after browser relaunch");
    }
    session.context = sharedContext as BrowserContext;
  }

  // Ensure context exists and is live
  if (!session.context || ((session.context as any).isClosed && (session.context as any).isClosed())) {
    console.log(`[playwright] Session ${sessionId} has no live context — attaching sharedContext or creating new one`);
    const b = await getBrowser();
    if (!sharedContext || ((sharedContext as any).isClosed && (sharedContext as any).isClosed())) {
      sharedContext = await b.newContext(CONTEXT_OPTIONS);
      console.log(`[playwright] created new sharedContext for session ${sessionId}`);
    }
    session.context = sharedContext as BrowserContext;
  }

  // If page missing or closed or its context appears closed, create a new page in same context
  try {
    const pageNowExists = !!session.page;
    const pageNowClosed = pageNowExists && session.page.isClosed ? session.page.isClosed() : false;
    const pageCtx = pageNowExists ? session.page.context() : session.context;
    const pageCtxClosed = pageCtx && (pageCtx as any).isClosed ? (pageCtx as any).isClosed() : false;

    if (!pageNowExists || pageNowClosed || pageCtxClosed) {
      if (pageNowExists && pageNowClosed) console.log(`[playwright] session ${sessionId} had closed page — creating new tab`);
      if (pageCtxClosed) console.log(`[playwright] session ${sessionId} had page/context closed — recreating page in shared context`);

      // create new page in session.context (which should be live now)
      session.page = await (session.context as BrowserContext).newPage();
      session.lastActivity = Date.now();
      session.state = "active";
      console.log(`[playwright] getSessionPage CREATED new page for session=${sessionId}`);
      return session.page;
    }
  } catch (e) {
    console.log(`[playwright] Error validating/creating page for session ${sessionId}, resetting session`, e);
    await resetSession(sessionId);
    const recreated = await getOrCreateSession(sessionId);
    return recreated.page;
  }

  // All good, reuse existing page
  session.lastActivity = Date.now();
  session.state = "active";
  console.log(`[playwright] getSessionPage REUSE existing page for session=${sessionId}`);
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
    if (session.state === "closed") continue;

    // Skip sessions whose page was closed and clean them up
    try {
      const pageClosed = session.page?.isClosed ? session.page.isClosed() : false;
      console.log(`[playwright] getMostRecentSessionPage check — session=${session.id} page.isClosed=${pageClosed}`);
      if (pageClosed) {
        console.log(`[playwright] Found closed page for session ${session.id}, resetting session`);
        await resetSession(session.id);
        continue;
      }
    } catch (e) {
      console.log(`[playwright] Error inspecting session ${session.id}, cleaning up`, e);
      await resetSession(session.id);
      continue;
    }

    if (!best || session.lastActivity > best.lastActivity) {
      best = session;
    }
  }

  if (best) {
    best.lastActivity = Date.now();
    best.state = "active";
    console.log(`[playwright] getMostRecentSessionPage: returning page from session ${best.id}`);
    return { page: best.page, sessionId: best.id };
  }

  // No existing healthy session — create a default one
  const session = await getOrCreateSession("default");
  console.log(`[playwright] getMostRecentSessionPage: created default session`);
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
    // Close only the page/tab for this session. Do NOT close the shared context here
    if (session.page && !session.page.isClosed()) {
      await session.page.close().catch(() => {});
      console.log(`[playwright] Closed page for session: ${sessionId}`);
    }
    // Do not close session.context because contexts are shared; they'll be closed by cleanupAll
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
  
  // If no sessions left, DO NOT automatically close the browser here.
  // Closing the browser aggressively can lead to "page.context or browser closed" errors
  // for subsequent tool calls. Keep browser/context available for reuse.
  if (sessions.size === 0) {
    console.log("[playwright] No active sessions remaining — leaving browser/context running for reuse");
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
  
  // Close shared context if present
  if (sharedContext) {
    try {
      await sharedContext.close();
    } catch {}
    sharedContext = null;
    console.log("[playwright] Shared context closed during cleanupAll");
  }

  // Close browser
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Ignore errors
    }
    browser = null;
    console.log("[playwright] Browser closed during cleanupAll");
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
