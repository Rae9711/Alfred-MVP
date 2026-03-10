/**
 * Tool Registry Module (工具注册表模块)
 * 
 * 这是系统中所有工具的单一数据源（Single Source of Truth）。
 * 
 * ## 核心职责
 * 
 * 1. **工具注册**: 所有工具通过 `registerTool()` 注册到这里
 * 2. **工具查找**: Executor 通过 `getTool(id)` 查找工具
 * 3. **目录生成**: Planner 通过 `getToolCatalog()` 获取工具列表（用于提示词）
 * 4. **权限管理**: 管理工具权限和中文标签
 * 
 * ## 工具定义结构
 * 
 * 每个工具必须定义：
 * - `id`: 唯一标识符（如 "contacts.apple"）
 * - `name`: 中文显示名称
 * - `description`: 中文描述（用于 Planner 提示词）
 * - `category`: 工具类别（content/platform/data/file）
 * - `permissions`: 所需权限列表
 * - `argsSchema`: 参数模式描述（JSON 字符串，用于 Planner）
 * - `outputSchema`: 输出模式描述（JSON 字符串，用于 Planner）
 * - `execute`: 执行函数（async，返回结构化数据）
 * 
 * ## 平台过滤
 * 
 * `getToolCatalog()` 会根据平台过滤工具，减少提示词大小：
 * - `imessage`: 只显示 contacts.apple, imessage.send（隐藏 mock 工具）
 * - `sms`: 只显示 contacts.lookup, sms.send（隐藏 Apple 工具）
 * - `wecom/dingtalk/feishu`: 只显示 platform.send（隐藏系统工具）
 * 
 * ## 使用示例
 * 
 * ```typescript
 * // 注册工具
 * registerTool({
 *   id: "my.tool",
 *   name: "我的工具",
 *   description: "工具描述",
 *   category: "data",
 *   permissions: [],
 *   argsSchema: '{ "arg": "参数" }',
 *   outputSchema: '{ "result": "结果" }',
 *   async execute(args, ctx) {
 *     return { result: "..." };
 *   }
 * });
 * 
 * // 查找工具
 * const tool = getTool("my.tool");
 * 
 * // 获取目录（用于 Planner）
 * const catalog = getToolCatalog("imessage");
 * ```
 */

// ── types ────────────────────────────────────────────────

export type ToolPermission =
  | "contacts.read"
  | "platform.send"
  | "files.write"
  | "email.send"
  | "email.read"
  | "calendar.write"
  | "reminders.write"
  | "files.read";

export type ToolCategory = "content" | "platform" | "data" | "file" | "productivity" | "communication" | "system";

export type ToolContext = {
  outboxDir: string;
  vars: Record<string, any>;
};

export type ToolDefinition = {
  id: string;
  /** Chinese display name */
  name: string;
  /** Chinese description */
  description: string;
  category: ToolCategory;
  permissions: ToolPermission[];
  /** Args schema description for the planner prompt */
  argsSchema: string;
  /** Output schema description for the planner prompt */
  outputSchema: string;
  /** Execute the tool — returns structured output */
  execute: (args: any, ctx: ToolContext) => Promise<any>;
};

// ── registry ─────────────────────────────────────────────

const TOOLS = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition) {
  if (TOOLS.has(tool.id)) {
    throw new Error(`Tool already registered: ${tool.id}`);
  }
  TOOLS.set(tool.id, tool);
  console.log(`[registry] registered tool: ${tool.id}`);
}

export function getTool(id: string): ToolDefinition | undefined {
  return TOOLS.get(id);
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(TOOLS.values());
}

export function getToolIds(): string[] {
  return Array.from(TOOLS.keys());
}

/**
 * Generate the tool catalog text for the planner prompt.
 * Optionally filter by platform to keep prompt small for slow LLMs.
 */
export function getToolCatalog(platform?: string): string {
  const lines: string[] = [];

  // Determine which messaging tools to show based on platform.
  // contacts.apple is always shown (iPhone contacts sync to Mac via iCloud).
  // Universal tools (search, email, calendar, pdf, clarify) are always shown.
  const skipIds = new Set<string>();
  if (platform === "imessage") {
    skipIds.add("sms.send");
    skipIds.add("platform.send");
    skipIds.add("wechat.send");
  } else if (platform === "sms") {
    skipIds.add("imessage.send");
    skipIds.add("platform.send");
    skipIds.add("wechat.send");
  } else if (platform === "wechat") {
    skipIds.add("imessage.send");
    skipIds.add("sms.send");
    skipIds.add("platform.send");
  } else {
    // wecom / dingtalk / feishu
    skipIds.add("imessage.send");
    skipIds.add("sms.send");
    skipIds.add("wechat.send");
  }

  for (const tool of TOOLS.values()) {
    if (skipIds.has(tool.id)) continue;
    lines.push(`- ${tool.id}: ${tool.description}. Args: ${tool.argsSchema}. Output: ${tool.outputSchema}`);
  }

  return lines.join("\n");
}

// ── permission labels (Chinese) ──────────────────────────

const PERMISSION_LABELS: Record<ToolPermission, string> = {
  "contacts.read": "读取本机联系人（需用户授权）",
  "platform.send": "使用你的账号发送消息（需用户授权）",
  "files.write": "写入文件",
  "email.send": "通过你的 Outlook 账户发送邮件",
  "email.read": "读取你的 Outlook 邮件",
  "calendar.write": "管理你的日历事件",
  "reminders.write": "管理你的待办事项",
  "files.read": "读取已上传的文件",
};

export function getPermissionLabel(perm: ToolPermission): string {
  return PERMISSION_LABELS[perm] ?? perm;
}
