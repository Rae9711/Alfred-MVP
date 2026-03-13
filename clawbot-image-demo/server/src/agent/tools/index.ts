/**
 * Tool registration entry point.
 * Import this file at server startup to register all tools.
 *
 * Each tool file self-registers via registerTool() on import.
 */

// ── AI / Local tools (unchanged) ───────────────────────
import "./text.generate.js";
import "./image.generate.js";
import "./pdf.process.js";
import "./file.save.js";
import "./clarify.js";

// ── Desktop computer-use tools (connector / macOS) ──────
// contacts.lookup removed — contacts.apple (macOS/iCloud) is used for all platforms
import "./contacts.apple.js";
import "./platform.send.js";
import "./sms.send.js";
import "./imessage.send.js";
import "./wechat.send.js";
import "./reminders.js";
import "./app.open.js";

// ── Browser computer-use tools (Playwright via connector) ─
import "./browser.search_flights.js";
import "./browser.open_page.js";
import "./browser.search_web.js";
import "./browser.extract_page.js";
import "./browser.click_link_by_text.js";
import "./browser.fill_input.js";
import "./browser.compose_gmail_draft.js";
import "./browser.read_gmail.js";
import "./browser.manage_calendar.js";
import "./browser.resume_gmail_after_login.js";
import "./browser.submit_chatgpt_prompt.js";

// ── DEPRECATED: API-based tools (replaced by browser computer-use) ──
// import "./web.search.js";      // replaced by browser.search_web
// import "./flights.search.js";  // replaced by browser.search_flights
// import "./email.send.js";      // replaced by browser.compose_gmail_draft
// import "./email.read.js";      // replaced by browser.read_gmail
// import "./calendar.js";        // replaced by browser.manage_calendar

import { getAllTools } from "./registry.js";

console.log(
  `[tools] ${getAllTools().length} tools registered:`,
  getAllTools().map((t) => t.id).join(", "),
);
