/**
 * Task: extractPage
 *
 * Reads the main visible text from the current active Playwright browser page.
 * Does NOT navigate anywhere — operates on whatever page is currently open.
 *
 * Extraction strategy:
 *  1. Remove <script>, <style>, <nav>, <header>, <footer>, <aside> elements
 *  2. Read innerText of <main>, <article>, or <body> (first match wins)
 *  3. Collapse whitespace and blank lines
 *  4. Truncate to MAX_CONTENT_CHARS
 *
 * Logs:
 *  [extractPage] current page URL: <url>
 *  [extractPage] title: <title>
 *  [extractPage] extracted text length: <n>
 *  [extractPage] truncated: <bool>
 */

import { getMostRecentSessionPage, markSessionIdle } from "../playwrightManager.js";

// ── Config ───────────────────────────────────────────────

const MAX_CONTENT_CHARS = 4_000;

// ── Types ────────────────────────────────────────────────

export type ExtractPageArgs = {
  mode?: "current_page";
};

export type ExtractPageResult = {
  success: boolean;
  url: string;
  title: string;
  content: string;
  truncated: boolean;
  error?: string;
};

// ── Main task ────────────────────────────────────────────

export async function extractPage(args: ExtractPageArgs): Promise<ExtractPageResult> {
  let sessionId = "unknown";

  try {
    const { page, sessionId: sid } = await getMostRecentSessionPage();
    sessionId = sid;

    const url = page.url();
    const title = await page.title();

    console.log(`[extractPage] current page URL: ${url}`);
    console.log(`[extractPage] title: ${title}`);

    if (!url || url === "about:blank") {
      return {
        success: false,
        url: url || "",
        title: title || "",
        content: "",
        truncated: false,
        error: "No page is currently open. Please search for a page first.",
      };
    }

    // Extract text — remove noise elements, prefer semantic containers
    const rawText: string = await page.evaluate(() => {
      // Remove noise nodes in-place (clone won't affect real DOM)
      const clone = document.documentElement.cloneNode(true) as HTMLElement;

      // Strip obviously noisy elements
      const noiseSelectors = [
        "script", "style", "noscript",
        "nav", "header", "footer", "aside",
        '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
        ".cookie-banner", ".cookie-notice", ".ad", ".ads", "#ad",
        ".sidebar", "#sidebar", ".navbar", "#navbar",
      ].join(", ");

      clone.querySelectorAll(noiseSelectors).forEach((el) => el.remove());

      // Prefer semantic content containers
      const candidates = [
        clone.querySelector("main"),
        clone.querySelector("article"),
        clone.querySelector('[role="main"]'),
        clone.querySelector(".content"),
        clone.querySelector("#content"),
        clone.querySelector(".post-content"),
        clone.querySelector(".article-body"),
        clone.querySelector("body"),
      ];

      for (const el of candidates) {
        if (el) {
          const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
          if (text.trim().length > 200) return text;
        }
      }

      return document.body?.innerText ?? document.body?.textContent ?? "";
    });

    // Normalize whitespace — collapse multiple blank lines, strip leading/trailing spaces per line
    const cleaned = rawText
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line, i, arr) => !(line.trim() === "" && arr[i - 1]?.trim() === "")) // collapse double blank lines
      .join("\n")
      .trim();

    const truncated = cleaned.length > MAX_CONTENT_CHARS;
    const content = truncated ? cleaned.slice(0, MAX_CONTENT_CHARS) + "\n…[content truncated]" : cleaned;

    console.log(`[extractPage] extracted text length: ${cleaned.length}`);
    console.log(`[extractPage] truncated: ${truncated}`);

    markSessionIdle(sessionId);

    return {
      success: true,
      url,
      title,
      content,
      truncated,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[extractPage] error: ${errorMessage}`);

    try { markSessionIdle(sessionId); } catch { /* ignore */ }

    return {
      success: false,
      url: "",
      title: "",
      content: "",
      truncated: false,
      error: errorMessage,
    };
  }
}
