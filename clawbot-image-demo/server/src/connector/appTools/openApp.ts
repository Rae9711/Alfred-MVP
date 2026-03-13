/**
 * Task: openApp
 *
 * Opens a desktop application on the local macOS machine using `open -a`.
 *
 * Supports an alias table so common shorthand names resolve correctly
 * (e.g. "wechat" → "WeChat", "vscode" → "Visual Studio Code").
 *
 * Logs:
 *   [appOpen] opening "<resolved>" (input: "<raw>")
 *   [appOpen] opened "<resolved>"
 *   [appOpen] app not found: "<resolved>"
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Alias table ───────────────────────────────────────────────────────────────
// Keys are lowercase. Values are exact macOS app bundle names.

export const APP_ALIASES: Record<string, string> = {
  // Messaging
  wechat:                   "WeChat",
  "微信":                   "WeChat",
  weixin:                   "WeChat",
  telegram:                 "Telegram",
  whatsapp:                 "WhatsApp",
  discord:                  "Discord",
  slack:                    "Slack",
  "line":                   "Line",

  // Browsers
  chrome:                   "Google Chrome",
  "google chrome":          "Google Chrome",
  safari:                   "Safari",
  firefox:                  "Firefox",
  "microsoft edge":         "Microsoft Edge",
  edge:                     "Microsoft Edge",
  arc:                      "Arc",
  brave:                    "Brave Browser",

  // Dev tools
  vscode:                   "Visual Studio Code",
  "vs code":                "Visual Studio Code",
  "visual studio code":     "Visual Studio Code",
  code:                     "Visual Studio Code",
  cursor:                   "Cursor",
  xcode:                    "Xcode",
  terminal:                 "Terminal",
  iterm:                    "iTerm",
  "iterm2":                 "iTerm",
  warp:                     "Warp",

  // Design
  figma:                    "Figma",
  sketch:                   "Sketch",
  "adobe xd":               "Adobe XD",

  // Productivity
  notion:                   "Notion",
  obsidian:                 "Obsidian",
  "linear":                 "Linear",
  zoom:                     "zoom.us",
  "zoom.us":                "zoom.us",
  finder:                   "Finder",
  calendar:                 "Calendar",
  notes:                    "Notes",
  reminders:                "Reminders",

  // Media
  spotify:                  "Spotify",
  "apple music":            "Music",
  music:                    "Music",
  vlc:                      "VLC",
};

// ── Types ────────────────────────────────────────────────────────────────────

export type OpenAppArgs = {
  name: string;
};

export type OpenAppResult = {
  success: boolean;
  app: string;
  opened: boolean;
  error?: string;
};

// ── Main task ─────────────────────────────────────────────────────────────────

export async function openApp(args: OpenAppArgs): Promise<OpenAppResult> {
  const rawName = (args.name ?? "").trim();
  if (!rawName) {
    return { success: false, app: "", opened: false, error: "No app name provided." };
  }

  const normalized = rawName.toLowerCase().replace(/\s+/g, " ");
  const resolvedName = APP_ALIASES[normalized] ?? rawName;

  console.log(`[appOpen] opening "${resolvedName}" (input: "${rawName}")`);

  try {
    await execFileAsync("open", ["-a", resolvedName]);
    console.log(`[appOpen] opened "${resolvedName}"`);
    return { success: true, app: resolvedName, opened: true };
  } catch (err: any) {
    const msg = String(err.stderr ?? err.message ?? err);
    if (/unable to find application|not found|can.t open/i.test(msg)) {
      console.warn(`[appOpen] app not found: "${resolvedName}"`);
      return {
        success: false,
        app: resolvedName,
        opened: false,
        error: `Application "${resolvedName}" was not found on this machine. Try the exact name as it appears in /Applications.`,
      };
    }
    console.error(`[appOpen] unexpected error: ${msg}`);
    return { success: false, app: resolvedName, opened: false, error: msg };
  }
}
