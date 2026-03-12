/**
 * Task: openPage
 *
 * Opens a URL in the Playwright-managed browser and returns the page title
 * and final URL after navigation.
 *
 * Logs:
 *  [openPage] navigating to <url>
 *  [openPage] page title detected: <title>
 *  [openPage] finalUrl: <url>
 */

import { getSessionPage, markSessionIdle } from "../playwrightManager.js";

// ── Known site shorthand → URL mapping ───────────────────

const SITE_MAP: Record<string, string> = {
  gmail: "https://mail.google.com",
  chatgpt: "https://chatgpt.com",
  openai: "https://openai.com",
  amazon: "https://www.amazon.com",
};

/**
 * Resolve a raw URL or site name to a fully qualified URL.
 * If `raw` already looks like a URL, return it as-is.
 */
export function resolveUrl(raw: string): string {
  const trimmed = raw.trim();

  // Already a URL?
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Check site map (case-insensitive, strip spaces)
  const key = trimmed.toLowerCase().replace(/\s+/g, "");
  if (SITE_MAP[key]) {
    return SITE_MAP[key];
  }

  // Treat as bare domain — add https://
  return `https://${trimmed}`;
}

// ── Types ────────────────────────────────────────────────

export type OpenPageArgs = {
  url: string;
};

export type OpenPageResult = {
  success: boolean;
  url: string;
  finalUrl?: string;
  title?: string;
  error?: string;
};

// ── Main task ────────────────────────────────────────────

export async function openPage(args: OpenPageArgs): Promise<OpenPageResult> {
  const requestedUrl = resolveUrl(args.url ?? "");

  console.log(`[openPage] navigating to ${requestedUrl}`);

  const page = await getSessionPage("open-page");

  try {
    await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const finalUrl = page.url();
    const title = await page.title();

    console.log(`[openPage] page title detected: ${title}`);
    console.log(`[openPage] finalUrl: ${finalUrl}`);

    markSessionIdle("open-page");

    return {
      success: true,
      url: requestedUrl,
      finalUrl,
      title,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[openPage] navigation failed: ${msg}`);

    markSessionIdle("open-page");

    return {
      success: false,
      url: requestedUrl,
      error: msg,
    };
  }
}
