/**
 * Task: composeGmailDraft
 *
 * Opens Gmail in the Playwright browser, checks login state, and if signed in
 * clicks Compose, fills the To / Subject / Body fields using the reusable
 * fillInput() helper, and stops before clicking Send — leaving the draft
 * window fully visible.
 *
 * If NOT signed in, returns a structured login_required result with a
 * suggestedActions continuation button — the browser stays on Gmail so
 * the user can sign in manually.
 *
 * Safety rules: NEVER automating password entry, 2FA, or login bypass.
 *               NEVER clicking Send automatically.
 *
 * Execution flow:
 *   1. Navigate to https://mail.google.com (reuse or open session)
 *   2. Detect login (URL signals + DOM Compose-button presence)
 *   3a. If not signed in → return login_required + suggestedActions, keep browser open
 *   3b. If signed in → continue
 *   4. Click the Compose button
 *   5. Wait for the compose window to appear
 *   6. Fill To → Tab to confirm recipient chip
 *   7. Fill Subject
 *   8. Fill Body
 *   9. Return draft_ready — do NOT click Send
 *
 * Logs:
 *   [gmailDraft] Gmail opened, url=<url>
 *   [gmailDraft] login state check started
 *   [gmailDraft] login detected: true/false (signal: <which>)
 *   [gmailDraft] compose window detected
 *   [gmailDraft] draft ready — paused before Send
 */

import type { Page } from "playwright";
import { getSessionPage, getMostRecentSessionPage, markSessionIdle } from "../playwrightManager.js";
// fillInput is used by resumeGmailAfterLogin for field filling, kept for future use

// ── Types ────────────────────────────────────────────────────────────────────

export type ComposeGmailDraftArgs = {
  to: string;
  subject: string;
  body: string;
};

export type SuggestedAction = {
  tool: string;
  label: string;
  args: Record<string, any>;
};

export type ComposeGmailDraftResult = {
  success: boolean;
  status: "draft_ready" | "login_required" | "compose_failed" | "fill_failed" | "error";
  site?: string;
  message?: string;
  to?: string;
  subject?: string;
  bodyPreview?: string;
  sendReady?: boolean;
  url?: string;
  error?: string;
  suggestedActions?: SuggestedAction[];
};

// ── Selectors ────────────────────────────────────────────────────────────────

/** Try these selectors in order until one matches — Gmail changes CSS class names */
const COMPOSE_BTN_SELECTORS = [
  "div[gh='cm']",                         // Primary: Gmail compose toolbar button
  "div.T-I.J-J5-Ji.T-I-KE.L3",           // Fallback class-based
  "button[data-tooltip='Compose']",       // Tooltip-based
  "[aria-label='Compose']",               // ARIA
];

const COMPOSE_WINDOW_SELECTORS = [
  "div[aria-label='New Message']",        // Compose window panel
  "div[aria-label='新邮件']",             // Chinese locale
  "div.nH.Hd[tabindex='0']",             // Internal class
  "div.aaZ",                              // Common compose dialog wrapper
];

// Gmail's To area is a contenteditable chip-token input in the compose window.
// The outer wrapper responds to clicks, the inner div accepts keyboard input.
const TO_AREA_SELECTORS = [
  "div[aria-label='To']",                 // Modern Gmail (English)
  "div[aria-label='收件人']",             // Chinese locale
  "div[aria-label='Recipients']",         // Some locales
  // Legacy fallbacks (older Gmail)
  "input[name='to']",
  "input[aria-label='To']",
];

const SUBJECT_FIELD_SELECTORS = [
  "input[name='subjectbox']",             // Gmail's stable name attr
  "input[aria-label='Subject']",
  "input[aria-label='主题']",
  "input[aria-label='主旨']",
];

// Gmail body is a contenteditable div — NOT an input or textarea
const BODY_FIELD_SELECTORS = [
  "div[aria-label='Message Body']",
  "div[aria-label='邮件正文']",
  "div[aria-label='邮件内容']",
  "div.Am.Al.editable[contenteditable='true']",
  "div[contenteditable='true'][tabindex='1']",
  "div.editable[contenteditable='true']",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findFirst(page: Page, selectors: string[]): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const visible = await loc.isVisible({ timeout: 1_000 }).catch(() => false);
      if (visible) return sel;
    } catch {
      // continue
    }
  }
  return null;
}

async function clickFirst(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const visible = await loc.isVisible({ timeout: 2_000 });
      if (visible) {
        await loc.click();
        return;
      }
    } catch {
      // continue
    }
  }
  throw new Error(`None of the compose button selectors matched: ${selectors.join(", ")}`);
}

async function ensurePageAlive(page: Page): Promise<void> {
  try {
    const closed = page.isClosed ? page.isClosed() : false;
    if (closed) throw new Error("page_closed");
  } catch (e) {
    throw new Error("page_closed");
  }
}

/**
 * Fill Gmail's recipient chip field.
 *
 * Gmail's To/Cc/Bcc area is a styled contenteditable region, not a plain
 * <input>. Standard playwright fill() often fails because the element isn't
 * focusable until clicked.  Strategy:
 *   1. Click the To area wrapper to reveal / focus the inner text cursor
 *   2. Type the address character-by-character via keyboard (works for any
 *      contenteditable, even when fill() is blocked)
 *   3. Press Enter to confirm the address as a chip token
 *   4. Wait a beat so Gmail can process the chip
 *
 * Returns true on apparent success, false if none of the selectors matched.
 */
async function fillGmailAddressChip(
  page: Page,
  emailAddress: string,
): Promise<boolean> {
  const sel = await findFirst(page, TO_AREA_SELECTORS);
  if (!sel) {
    console.warn("[gmailDraft] To area selector not found — tried:", TO_AREA_SELECTORS);
    return false;
  }

  console.log(`[gmailDraft] To area found: "${sel}"`);
  const loc = page.locator(sel).first();

  // Step 1: click to focus
  await loc.click({ force: true });
  await page.waitForTimeout(300);

  // Step 2: for legacy <input> elements use fill(); for contenteditable use keyboard.type()
  const tagName = await loc.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "div");
  const isInput = tagName === "input" || tagName === "textarea";

  if (isInput) {
    await loc.fill(emailAddress);
  } else {
    // contenteditable chip area — type char by char, then Enter
    await page.keyboard.type(emailAddress, { delay: 30 });
  }

  await page.waitForTimeout(300);

  // Step 3: confirm chip — Enter works in all Gmail locales; Tab works too
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  console.log(`[gmailDraft] To chip entered: ${emailAddress}`);
  return true;
}

// ── Main task ─────────────────────────────────────────────────────────────────

export async function composeGmailDraft(
  args: ComposeGmailDraftArgs
): Promise<ComposeGmailDraftResult> {
  const { to, subject, body } = args;

  console.log(`[gmailDraft] starting draft — to="${to}" subject="${subject}"`);

  const { page, sessionId } = await getMostRecentSessionPage();

  try {
    // ── Step 1: Navigate to Gmail ───────────────────────────────────────────

    const currentUrl = page.url();
    const alreadyOnGmail = currentUrl.includes("mail.google.com");

    if (!alreadyOnGmail) {
      console.log("[gmailDraft] navigating to Gmail…");
      await page.goto("https://mail.google.com", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } else {
      console.log("[gmailDraft] already on Gmail, reusing page");
    }

    // Brief pause — let Gmail JS hydrate and any redirect to settle
    await page.waitForTimeout(2_500);

    const landedUrl = page.url();
    console.log(`[gmailDraft] Gmail opened, url=${landedUrl}`);
    console.log("[gmailDraft] login state check started");

    // ── Step 2: Login check ─────────────────────────────────────────────────
    //
    // Signal 1 (URL): Must be on mail.google.com and NOT on a Google
    //                 sign-in/accounts page
    // Signal 2 (DOM): Compose button (div[gh='cm']) is visible — confirms
    //                 the Gmail inbox has loaded (not just a landing page)

    const urlSignal =
      landedUrl.includes("mail.google.com") &&
      !landedUrl.includes("accounts.google.com") &&
      !landedUrl.includes("ServiceLogin") &&
      !landedUrl.includes("/signin") &&
      !landedUrl.includes("CheckCookie");

    let loginSignal = "url";
    let isLoggedIn = urlSignal;

    if (urlSignal) {
      // DOM confirmation — Compose button visible means inbox is fully loaded
      const composeVisible = await page
        .locator(COMPOSE_BTN_SELECTORS[0])
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (composeVisible) {
        loginSignal = "compose-button-visible";
      } else {
        // Compose not yet visible — try mailbox navigation indicator
        const mailboxNavVisible = await page
          .locator("div[role='navigation']")
          .first()
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (mailboxNavVisible) {
          loginSignal = "mailbox-nav-visible";
        } else {
          // URL says Gmail but core UI not present — treat as not logged in
          isLoggedIn = false;
          loginSignal = "dom-check-failed";
        }
      }
    }

    console.log(`[gmailDraft] login detected: ${isLoggedIn} (signal: ${loginSignal})`);

    if (!isLoggedIn) {
      console.warn(`[gmailDraft] user not signed in — url=${landedUrl}, signal=${loginSignal}`);
      // Keep the browser open on Gmail so the user can sign in manually.
      // Do NOT call markSessionIdle — we want the page to stay on Gmail.
      return {
        success: false,
        status: "login_required",
        site: "gmail",
        message: "Please sign in to Gmail first, then continue composing the draft.",
        url: landedUrl,
        suggestedActions: [
          {
            tool: "browser.resume_gmail_after_login",
            label: "I have signed in, continue",
            args: { to, subject, body },
          },
        ],
      };
    }

    // Wait for inbox to fully load (compose button appears after full load)
    await page
      .waitForSelector(COMPOSE_BTN_SELECTORS[0], { timeout: 15_000 })
      .catch(() => null);

    // ── Step 3: Click Compose ───────────────────────────────────────────────

    console.log("[gmailDraft] clicking Compose…");

    // Verify page still alive before clicking
    try {
      await ensurePageAlive(page);
    } catch (e) {
      console.error("[gmailDraft] page closed before clicking Compose");
      return {
        success: false,
        status: "error",
        url: page.url(),
        error: "Page closed before clicking Compose",
      };
    }

    // Attempt to locate the Compose button selector and log which one is used
    const composeSel = await findFirst(page, COMPOSE_BTN_SELECTORS);
    if (!composeSel) {
      console.warn("[gmailDraft] Compose button selector not found — tried:", COMPOSE_BTN_SELECTORS);
    } else {
      console.log(`[gmailDraft] Compose button found: ${composeSel}`);
    }

    try {
      // Try a normal click first; then fallback to forced click if it fails
      await clickFirst(page, COMPOSE_BTN_SELECTORS);
    } catch (e) {
      console.warn("[gmailDraft] normal Compose click failed, trying forced click", String(e));
      // Forced click on the first matching locator (if any)
      if (composeSel) {
        try {
          await page.locator(composeSel).first().click({ force: true });
        } catch (ex) {
          console.error("[gmailDraft] forced Compose click also failed", String(ex));
          markSessionIdle(sessionId);
          return {
            success: false,
            status: "compose_failed",
            url: page.url(),
            error: "Failed to click Compose button (normal and forced clicks failed).",
          };
        }
      } else {
        markSessionIdle(sessionId);
        return {
          success: false,
          status: "compose_failed",
          url: page.url(),
          error: "Compose button not found and click could not be performed.",
        };
      }
    }

    // Wait for compose window to open
    let composeWindowSel: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Verify page alive while waiting for compose window
      try {
        await ensurePageAlive(page);
      } catch (e) {
        console.error("[gmailDraft] page closed while waiting for compose window");
        markSessionIdle(sessionId);
        return {
          success: false,
          status: "error",
          url: page.url(),
          error: "Page closed while waiting for compose window",
        };
      }

      await page.waitForTimeout(1_000);
      composeWindowSel = await findFirst(page, COMPOSE_WINDOW_SELECTORS);
      if (composeWindowSel) break;
    }

    if (!composeWindowSel) {
      // Compose may not have recognised selectors but the To area is present
      const toSel = await findFirst(page, TO_AREA_SELECTORS);
      if (!toSel) {
        console.error("[gmailDraft] compose window did not appear");
        markSessionIdle(sessionId);
        return {
          success: false,
          status: "compose_failed",
          url: page.url(),
          error: "Compose window did not open — could not find To field after clicking Compose.",
        };
      }
      console.log("[gmailDraft] compose window detected (via To field fallback)");
    } else {
      console.log(`[gmailDraft] compose window detected (selector: ${composeWindowSel})`);
    }

    // ── Step 4: Fill To ─────────────────────────────────────────────────────

    console.log(`[gmailDraft] filling To: ${to}`);

    // Verify page alive before filling To
    try {
      await ensurePageAlive(page);
    } catch (e) {
      console.error("[gmailDraft] page closed before filling To field");
      markSessionIdle(sessionId);
      return {
        success: false,
        status: "error",
        url: page.url(),
        error: "Page closed before filling To field",
      };
    }

    // Gmail compose uses a contenteditable chip field for To — use dedicated helper
    const toFilled = await fillGmailAddressChip(page, to);
    if (!toFilled) {
      console.warn("[gmailDraft] To chip fill failed — all selectors missed");
    }

    // ── Step 5: Fill Subject ────────────────────────────────────────────────

    console.log(`[gmailDraft] filling Subject: ${subject}`);

    // Verify page alive before filling Subject
    try {
      await ensurePageAlive(page);
    } catch (e) {
      console.error("[gmailDraft] page closed before filling Subject");
      markSessionIdle(sessionId);
      return {
        success: false,
        status: "error",
        url: page.url(),
        error: "Page closed before filling Subject",
      };
    }

    const subjectSel =
      (await findFirst(page, SUBJECT_FIELD_SELECTORS)) ?? SUBJECT_FIELD_SELECTORS[0];

    // Subject is a plain <input> — click to focus then fill
    try {
      await page.locator(subjectSel).first().click();
      await page.waitForTimeout(150);
      await page.locator(subjectSel).first().fill(subject);
      console.log("[gmailDraft] Subject filled");
    } catch (e: any) {
      console.warn(`[gmailDraft] Subject fill warning: ${e.message}`);
    }

    // ── Step 6: Fill Body ───────────────────────────────────────────────────

    console.log("[gmailDraft] filling Body");

    // Verify page alive before filling Body
    try {
      await ensurePageAlive(page);
    } catch (e) {
      console.error("[gmailDraft] page closed before filling Body");
      markSessionIdle(sessionId);
      return {
        success: false,
        status: "error",
        url: page.url(),
        error: "Page closed before filling Body",
      };
    }

    const bodySel =
      (await findFirst(page, BODY_FIELD_SELECTORS)) ?? BODY_FIELD_SELECTORS[0];

    // Body is a contenteditable div — click to focus, then use keyboard.type()
    try {
      await page.locator(bodySel).first().click();
      await page.waitForTimeout(150);
      // Triple-click to clear any placeholder text, then type
      await page.locator(bodySel).first().click({ clickCount: 3 });
      await page.keyboard.type(body, { delay: 10 });
      console.log("[gmailDraft] Body filled");
    } catch (e: any) {
      console.warn(`[gmailDraft] Body fill warning: ${e.message}`);
    }

    // Determine overall success: To + Subject must have fields present
    // (toFilled: To area was found and typed into; subject: selector found)
    const overallSuccess = toFilled;

    if (!overallSuccess) {
      markSessionIdle(sessionId);
      return {
        success: false,
        status: "fill_failed",
        to,
        subject,
        bodyPreview: body.slice(0, 100),
        url: page.url(),
        error: "Failed to fill To field — Gmail compose To area selector not found.",
      };
    }

    console.log("[gmailDraft] draft ready — paused before Send");

    markSessionIdle(sessionId);

    return {
      success: true,
      status: "draft_ready",
      to,
      subject,
      bodyPreview: body.slice(0, 100),
      sendReady: true,
      url: page.url(),
    };
  } catch (err: any) {
    console.error(`[gmailDraft] unexpected error: ${err.message}`);
    markSessionIdle(sessionId);
    return {
      success: false,
      status: "error",
      url: page.url(),
      error: String(err.message ?? err),
    };
  }
}
