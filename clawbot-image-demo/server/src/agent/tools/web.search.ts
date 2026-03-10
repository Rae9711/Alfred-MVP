/**
 * Tool: web.search
 *
 * Searches the web for real-time information using the Brave Search API.
 * Returns structured results with title, URL, and snippet for each hit.
 */

import { registerTool, type ToolContext } from "./registry.js";

// ── Brave Search API types ──────────────────────────────

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveWebResult[];
  };
};

// ── tool registration ───────────────────────────────────

registerTool({
  id: "web.search",
  name: "网络搜索",
  description: "搜索网络获取实时信息、新闻、产品、价格等",
  category: "data",
  permissions: [],
  argsSchema: '{ "query": "搜索查询内容", "count": "(可选) 返回结果数量，默认 5" }',
  outputSchema: '{ "results": [{ "title": "...", "url": "...", "snippet": "..." }] }',

  async execute(
    args: { query: string; count?: number },
    _ctx: ToolContext,
  ) {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      return { error: "BRAVE_SEARCH_API_KEY is not configured" };
    }

    const query = (args.query ?? "").trim();
    if (!query) {
      return { error: "web.search requires a non-empty query" };
    }

    const count = Math.min(Math.max(args.count ?? 5, 1), 20);

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-Subscription-Token": apiKey,
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          error: `Brave Search API returned ${response.status}: ${body || response.statusText}`,
        };
      }

      const data = (await response.json()) as BraveSearchResponse;

      const results = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
      }));

      return { results };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Web search failed: ${message}` };
    }
  },
});
