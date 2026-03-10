/**
 * Tool registration entry point.
 * Import this file at server startup to register all tools.
 *
 * Each tool file self-registers via registerTool() on import.
 */

import "./text.generate.js";
import "./image.generate.js";
// contacts.lookup removed — contacts.apple (macOS/iCloud) is used for all platforms
import "./contacts.apple.js";
import "./platform.send.js";
import "./sms.send.js";
import "./imessage.send.js";
import "./file.save.js";
import "./clarify.js";
import "./web.search.js";
import "./email.send.js";
import "./email.read.js";
import "./wechat.send.js";
import "./calendar.js";
import "./reminders.js";
import "./pdf.process.js";
import "./flights.search.js";

import { getAllTools } from "./registry.js";

console.log(
  `[tools] ${getAllTools().length} tools registered:`,
  getAllTools().map((t) => t.id).join(", "),
);
