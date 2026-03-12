/**
 * Task: searchWeb
 *
 * Opens DuckDuckGo in a Playwright-managed browser, submits a search query,
 * waits for the results page, and extracts the top organic results.
 * Falls back to Google if DuckDuckGo yields no results.
 *
 * Logs:
 *  [searchWeb] query: <query>
 *  [searchWeb] searchUrl: <url>
 *  [searchWeb] extracted <n> results
 */

import { getSessionPage, markSessionIdle } from "../playwrightManager.js";

// ── Types ────────────────────────────────────────────────

export type SearchWebArgs = {
  query: string;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type SuggestedAction = {
  tool: string;
  label: string;
  args: Record<string, any>;
};

export type SearchWebResult = {
  success: boolean;
  query: string;
  searchUrl: string;
  results: SearchResult[];
  warnings: string[];
  error?: string;
  suggestedActions?: SuggestedAction[];
};

// ── DuckDuckGo extraction ────────────────────────────────

async function extractDDGResults(page: any): Promise<SearchResult[]> {
  // DuckDuckGo organic result selectors (2024-2025 layout)
  try {
    return await page.$$eval(
      "article[data-testid='result']",
      (nodes: Element[]): SearchResult[] =>
        nodes
          .map((node) => {
            const titleEl = node.querySelector("h2 a span") ?? node.querySelector("h2 a") ?? node.querySelector("h2");
            const linkEl = node.querySelector("h2 a");
            const snippetEl = node.querySelector("[data-result='snippet']") ?? node.querySelector(".kgXNkd") ?? node.querySelector("span.Y4afP");

            const title = titleEl?.textContent?.trim() ?? "";
            const url = (linkEl as HTMLAnchorElement)?.href ?? "";
            const snippet = snippetEl?.textContent?.trim() ?? "";

            if (!title || !url) return null as unknown as SearchResult;
            return { title, url, snippet };
          })
          .filter(Boolean)
          .slice(0, 5)
    );
  } catch {
    return [];
  }
}

// ── Google extraction ────────────────────────────────────

async function extractGoogleResults(page: any): Promise<SearchResult[]> {
  // Multiple strategies — Google changes its DOM frequently
  const strategies = [
    // Strategy 1: h3 inside an anchor with href that is a real URL
    async () => page.$$eval("#search a:has(h3)", (nodes: Element[]): SearchResult[] =>
      nodes.map((n: Element) => {
        const a = n as HTMLAnchorElement;
        const title = a.querySelector("h3")?.textContent?.trim() ?? "";
        let url = a.href ?? "";
        if (url.includes("/url?q=")) {
          try { url = new URL(url).searchParams.get("q") ?? url; } catch { /* keep */ }
        }
        if (!title || !url || url.startsWith("https://www.google.com")) return null as unknown as SearchResult;
        const parent = a.closest("[data-hveid], .g, article");
        const snippet = parent?.querySelector(".VwiC3b, .lEBKkf, [data-sncf='1'], span[class]")?.textContent?.trim() ?? "";
        return { title, url, snippet };
      }).filter(Boolean).slice(0, 5)
    ),
    // Strategy 2: div.g fallback
    async () => page.$$eval("div.g", (nodes: Element[]): SearchResult[] =>
      nodes.map((node) => {
        const titleEl = node.querySelector("h3");
        const linkEl = node.querySelector("a[href]");
        const snippetEl = node.querySelector(".VwiC3b, .lEBKkf");
        const title = titleEl?.textContent?.trim() ?? "";
        let url = (linkEl as HTMLAnchorElement)?.href ?? "";
        if (!title || !url || url.startsWith("https://www.google.com/search")) return null as unknown as SearchResult;
        return { title, url, snippet: snippetEl?.textContent?.trim() ?? "" };
      }).filter(Boolean).slice(0, 5)
    ),
  ];

  for (const strategy of strategies) {
    try {
      const results = await strategy();
      if (results && results.length > 0) return results;
    } catch { /* try next */ }
  }
  return [];
}

// ── Main task ────────────────────────────────────────────

export async function searchWeb(args: SearchWebArgs): Promise<SearchWebResult> {
  const query = (args.query ?? "").trim();
  if (!query) {
    return { success: false, query: "", searchUrl: "", results: [], warnings: [], error: "query is required" };
  }

  const encodedQuery = encodeURIComponent(query);
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  console.log(`[searchWeb] query: ${query}`);
  console.log(`[searchWeb] searchUrl: ${ddgUrl}`);

  const page = await getSessionPage("search-web");
  const warnings: string[] = [];

  try {
    // Use DuckDuckGo HTML version — minimal bot detection, fast, reliable
    await page.goto(ddgUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait for results to appear
    try {
      await page.waitForSelector(".result, .results, #links", { timeout: 8_000 });
    } catch {
      warnings.push("DDG results container not found within 8s");
    }

    // DuckDuckGo HTML results: <div class="result"> each with <a class="result__a"> and <a class="result__snippet">
    let results: SearchResult[] = [];

    try {
      results = await page.$$eval(
        ".result__body, .result",
        (nodes: Element[]): SearchResult[] =>
          nodes
            .map((node) => {
              const titleEl = node.querySelector(".result__a, a.result__a") as HTMLAnchorElement | null;
              const snippetEl = node.querySelector(".result__snippet, .result__url");
              const title = titleEl?.textContent?.trim() ?? "";
              let url = titleEl?.href ?? "";

              if (!title || !url) return null as unknown as SearchResult;
              // DDG wraps URLs in redirects — try to get the real URL
              if (url.includes("duckduckgo.com/l/?uddg=")) {
                try {
                  const u = new URL(url);
                  const real = u.searchParams.get("uddg");
                  if (real) url = decodeURIComponent(real);
                } catch { /* keep */ }
              }
              const snippet = snippetEl?.textContent?.trim() ?? "";
              return { title, url, snippet };
            })
            .filter(Boolean)
            .slice(0, 5)
      );
    } catch (e) {
      warnings.push(`DDG extraction failed: ${(e as Error).message}`);
    }

    // Fallback: try Google if DDG gave nothing
    if (results.length === 0) {
      warnings.push("DDG extraction empty, trying Google...");
      const googleUrl = `https://www.google.com/search?q=${encodedQuery}&hl=en`;
      try {
        await page.goto(googleUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(1_500);
        results = await extractGoogleResults(page);
        if (results.length === 0) {
          warnings.push("Google extraction also empty — page layout may differ");
        }
      } catch (e) {
        warnings.push(`Google fallback failed: ${(e as Error).message}`);
      }
    }

    console.log(`[searchWeb] extracted ${results.length} results`);

    markSessionIdle("search-web");

    // Build suggested actions: open up to top 2 results
    const suggestedActions: SuggestedAction[] = results
      .slice(0, 2)
      .map((r, i) => ({
        tool: "browser.click_link_by_text",
        label: `Open result ${i + 1}: "${r.title.slice(0, 50)}"`,
        args: { ordinal: i + 1 },
      }));

    console.log(`[searchWeb] suggestedActions generated: ${JSON.stringify(suggestedActions)}`);

    return {
      success: results.length > 0,
      query,
      searchUrl: ddgUrl,
      results,
      warnings,
      ...(suggestedActions.length > 0 ? { suggestedActions } : {}),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[searchWeb] error: ${errorMessage}`);
    try { markSessionIdle("search-web"); } catch { /* ignore */ }
    return { success: false, query, searchUrl: ddgUrl, results: [], warnings, error: errorMessage };
  }
}
