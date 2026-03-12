/**
 * Task: clickLinkByText
 *
 * Opens the Nth search result from the current browser page.
 * Used as a suggested action after browser.search_web returns results.
 *
 * Extracts the Nth result link from the currently open DuckDuckGo (or Google)
 * search results page, navigates to it, and returns the opened page info.
 *
 * After opening the page, suggests browser.extract_page as a follow-up action.
 *
 * Logs:
 *  [clickLinkByText] ordinal: <n>
 *  [clickLinkByText] found <n> result links
 *  [clickLinkByText] navigating to: <url>
 *  [clickLinkByText] opened: title="<title>" url="<url>"
 *  [clickLinkByText] suggestedActions generated: <json>
 */

import { getMostRecentSessionPage } from "../playwrightManager.js";

// ── Types ────────────────────────────────────────────────

export type SuggestedAction = {
  tool: string;
  label: string;
  args: Record<string, any>;
};

export type ClickLinkByTextArgs = {
  /** 1-indexed ordinal for which result to open (1 = first, 2 = second, etc.) */
  ordinal?: number;
};

export type ClickLinkByTextResult = {
  success: boolean;
  url?: string;
  title?: string;
  message?: string;
  error?: string;
  suggestedActions?: SuggestedAction[];
};

// ── Main task ────────────────────────────────────────────

export async function clickLinkByText(
  args: ClickLinkByTextArgs,
): Promise<ClickLinkByTextResult> {
  const ordinal = Math.max(1, args.ordinal ?? 1);
  const index = ordinal - 1; // convert to 0-indexed

  console.log(`[clickLinkByText] ordinal: ${ordinal}`);

  try {
    const { page } = await getMostRecentSessionPage();

    // Extract result URLs from the current search results page.
    // Handles both DuckDuckGo HTML and DuckDuckGo JS layouts.
    const links = await page
      .$$eval(
        [
          ".result__a",           // DuckDuckGo HTML classic
          "a.result__a",          // DuckDuckGo HTML alternative
          "article[data-testid='result'] h2 a",  // DuckDuckGo JS layout
          "#search a:has(h3)",    // Google fallback
        ].join(", "),
        (nodes: Element[]) =>
          nodes
            .map((n) => ({
              href: (n as HTMLAnchorElement).href ?? "",
              text: (n as HTMLElement).textContent?.trim() ?? "",
            }))
            .filter(
              (r) =>
                r.href &&
                !r.href.includes("duckduckgo.com/y.js") &&
                !r.href.includes("duckduckgo.com/search") &&
                !r.href.startsWith("https://www.google.com/search"),
            )
            .slice(0, 10),
      )
      .catch(() => [] as { href: string; text: string }[]);

    console.log(`[clickLinkByText] found ${links.length} result links`);

    if (links.length === 0) {
      return {
        success: false,
        error:
          "No search results found on current page. Please run browser.search_web first.",
      };
    }

    if (index >= links.length) {
      return {
        success: false,
        error: `Only ${links.length} results available; cannot open result #${ordinal}.`,
      };
    }

    let targetUrl = links[index].href;

    // Unwrap DuckDuckGo redirect URLs
    if (targetUrl.includes("uddg=")) {
      try {
        const u = new URL(targetUrl);
        const real = u.searchParams.get("uddg");
        if (real) targetUrl = decodeURIComponent(real);
      } catch {
        /* keep original url */
      }
    }

    console.log(`[clickLinkByText] navigating to: ${targetUrl}`);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const title = await page.title();
    const finalUrl = page.url();

    console.log(
      `[clickLinkByText] opened: title="${title}" url="${finalUrl}"`,
    );

    const suggestedActions: SuggestedAction[] = [
      {
        tool: "browser.extract_page",
        label: "Summarize this page",
        args: { mode: "current_page" },
      },
    ];

    console.log(
      `[clickLinkByText] suggestedActions generated: ${JSON.stringify(suggestedActions)}`,
    );

    return {
      success: true,
      url: finalUrl,
      title,
      message: `Opened: ${title}`,
      suggestedActions,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[clickLinkByText] error: ${msg}`);
    return { success: false, error: msg };
  }
}
