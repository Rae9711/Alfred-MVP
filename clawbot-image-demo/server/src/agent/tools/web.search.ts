/**
 * Tool: web.search
 *
 * Searches the web for real-time information.
 * - Uses Gemini with Google Search grounding when available (free!)
 * - Falls back to Brave Search API if configured
 */

import { registerTool, type ToolContext } from "./registry.js";
import { getSettings, chatCompletion } from "../llm.js";

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

// ── Gemini search (free with Google Search grounding) ───

async function searchWithGemini(query: string, count: number): Promise<{ results: Array<{ title: string; url: string; snippet: string }> } | { error: string }> {
  try {
    console.log(`[web.search] Gemini search for: "${query}"`);
    const result = await chatCompletion({
      messages: [{ 
        role: "user", 
        content: `你是一个搜索助手。请搜索: "${query}"

请根据搜索结果，返回${count}条最相关的信息，格式为JSON数组：
[
  {"title": "标题", "url": "网址", "snippet": "简短摘要"},
  ...
]

要求：
1. 使用你的Google搜索能力获取最新信息
2. 每条结果必须包含真实的URL
3. snippet要简洁有用
4. 只返回JSON数组，不要其他文字` 
      }],
      role: "tool",
      forceJson: true,
      maxTokens: 2048,
    });

    console.log(`[web.search] Gemini response: ${result.content.slice(0, 200)}...`);

    // Parse the JSON response
    let parsed: any[];
    try {
      const content = result.content.trim();
      // Handle both array and object with results key
      const json = JSON.parse(content);
      parsed = Array.isArray(json) ? json : (json.results ?? []);
    } catch (e) {
      console.error(`[web.search] Failed to parse Gemini response: ${result.content.slice(0, 200)}`);
      // If parsing fails, return error
      return { error: "Failed to parse Gemini search results" };
    }

    const results = parsed.slice(0, count).map((r: any) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: String(r.snippet ?? r.description ?? ""),
    }));

    console.log(`[web.search] Gemini returned ${results.length} results`);
    return { results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[web.search] Gemini search error: ${message}`);
    return { error: `Gemini search failed: ${message}` };
  }
}

// ── LLM-based search fallback (uses current LLM provider's knowledge) ───

async function searchWithLLM(query: string, count: number): Promise<{ results: Array<{ title: string; url: string; snippet: string }> } | { error: string }> {
  try {
    console.log(`[web.search] LLM knowledge search for: "${query}"`);
    const result = await chatCompletion({
      messages: [{ 
        role: "user", 
        content: `用户想了解: "${query}"

请基于你的知识，提供${count}条相关信息，格式为JSON数组：
[
  {"title": "主题标题", "url": "", "snippet": "详细说明"},
  ...
]

要求：
1. 提供准确、有用的信息
2. url字段留空（因为这是基于知识库的回答）
3. snippet要详细且有帮助
4. 只返回JSON数组，不要其他文字
5. 如果涉及实时信息（如最新新闻、股价等），请说明信息可能不是最新的` 
      }],
      role: "tool",
      forceJson: true,
      maxTokens: 2048,
    });

    console.log(`[web.search] LLM response: ${result.content.slice(0, 200)}...`);

    // Parse the JSON response
    let parsed: any[];
    try {
      let content = result.content.trim();
      
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        content = jsonMatch[1].trim();
      }
      
      // Try to find JSON array in the content
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        content = arrayMatch[0];
      }
      
      const json = JSON.parse(content);
      parsed = Array.isArray(json) ? json : (json.results ?? []);
    } catch (e) {
      console.error(`[web.search] Failed to parse LLM response: ${result.content.slice(0, 300)}`);
      // Return a fallback result with the raw content as a single result
      return { 
        results: [{
          title: "AI 知识回答",
          url: "",
          snippet: result.content.slice(0, 500)
        }]
      };
    }

    const results = parsed.slice(0, count).map((r: any) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: String(r.snippet ?? r.description ?? ""),
    }));

    console.log(`[web.search] LLM returned ${results.length} results`);
    return { results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[web.search] LLM search error: ${message}`);
    return { error: `Search failed: ${message}` };
  }
}

// ── Brave Search ────────────────────────────────────────

async function searchWithBrave(query: string, count: number, apiKey: string): Promise<{ results: Array<{ title: string; url: string; snippet: string }> } | { error: string }> {
  console.log(`[web.search] Brave search for: "${query}" with key: ${apiKey.slice(0, 10)}...`);
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
      console.error(`[web.search] Brave API error: ${response.status} ${body.slice(0, 200)}`);
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

    console.log(`[web.search] Brave returned ${results.length} results`);
    return { results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Brave search failed: ${message}` };
  }
}

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
    const query = (args.query ?? "").trim();
    if (!query) {
      return { error: "web.search requires a non-empty query" };
    }

    const count = Math.min(Math.max(args.count ?? 5, 1), 20);
    const settings = getSettings();
    
    console.log(`[web.search] Settings: hasBrave=${!!settings.braveSearchKey}, hasGemini=${!!settings.geminiKey}, envBrave=${!!process.env.BRAVE_SEARCH_API_KEY}`);

    // Priority 1: Use Brave Search API (real search, most reliable)
    const braveKey = settings.braveSearchKey || process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey && !braveKey.startsWith('bb_')) { // Skip Browserbase keys
      console.log("[web.search] Using Brave Search API");
      const result = await searchWithBrave(query, count, braveKey);
      if (!('error' in result)) {
        console.log(`[web.search] Result: ${JSON.stringify(result).slice(0, 200)}`);
        return result;
      }
      console.log(`[web.search] Brave failed, trying fallback: ${result.error}`);
    }

    // Priority 2: Use LLM knowledge (Claude/Gemini/Ollama) as fallback
    // This uses the current LLM provider's knowledge base
    console.log("[web.search] Using LLM knowledge search (fallback)");
    const result = await searchWithLLM(query, count);
    console.log(`[web.search] Result: ${JSON.stringify(result).slice(0, 200)}`);
    return result;
  },
});
