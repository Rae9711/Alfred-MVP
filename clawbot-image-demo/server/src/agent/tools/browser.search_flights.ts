/**
 * Tool: browser.search_flights
 * 
 * Server-side schema stub for the planner.
 * 
 * This tool MUST run via connector (user's machine) where Playwright is available.
 * The execute() function here is a fallback that returns an error if somehow
 * called directly on the server instead of being routed to the connector.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.search_flights",
  name: "搜索航班（浏览器）",
  description: "【航班搜索首选工具】在用户电脑上打开真实浏览器访问 Google Flights，搜索航班并返回实时结果。当用户要搜航班、查机票、flight search 时必须使用此工具，不要用 web.search。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema:
    '{ "origin": "出发城市或机场代码（如 New York 或 NYC）", "destination": "目的城市或机场代码（如 Detroit 或 DTW）", "date": "(可选) 出发日期 YYYY-MM-DD，默认明天", "returnDate": "(可选) 返回日期 YYYY-MM-DD，用于往返搜索" }',
  outputSchema:
    '{ "success": true/false, "searchUrl": "Google Flights URL", "searchParams": { "origin": "出发地", "destination": "目的地", "date": "YYYY-MM-DD", "returnDate": "YYYY-MM-DD(可选)" }, "flights": [{ "airline": "航空公司", "departure": "出发时间", "arrival": "到达时间", "duration": "飞行时长", "stops": "经停", "price": "价格" }], "warnings": ["提取告警"], "resultsPageVerification": { "finalUrl": "最终页面URL", "selectorMatched": "匹配到的结果选择器", "visibleFlightCards": 0, "resultsPageReached": true }, "error": "错误信息（如果失败）" }',

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    // If this function is called, it means the tool was not properly routed to the connector.
    return {
      success: false,
      error:
        "browser.search_flights 必须通过本地 Connector 执行。请确保 Connector 已连接并且会话已绑定 Connector ID。",
      requiresConnector: true,
    };
  },
});
