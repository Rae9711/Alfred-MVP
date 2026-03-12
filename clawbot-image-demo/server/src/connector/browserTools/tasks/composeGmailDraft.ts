/**
 * Task: composeGmailDraft
 *
 * Opens Gmail in the Playwright browser, clicks Compose, fills the To /
 * Subject / Body fields using the reusable fillInput() helper, and stops
 * before clicking Send — leaving the draft window fully visible.
 *
 * Uses fillInput() from Phase 1 for all three fields so typing logic is
 * never duplicated.
 *
 * Execution flow:
 *   1. Navigate to https://mail.google.com (reuse or open session)
 *   2. Detect login (URL must stay in mail.google.com)
 *   3. Click the Compose button
 *   4. Wait for the compose window to appear
 *   5. Fill To → Tab to confirm recipient chip
 *   6. Fill Subject
 *   7. Fill Body
 *   8. Return draft_ready — do NOT click Send
 *
 * Logs:
 *   [gmailDraft] Gmail opened, url=<url>
 *   [gmailDraft] login detected / not logged in
 *   [gmailDraft] clicking Compose…
 *   [gmailDraft] compose window detected
 *   [gmailDraft] filling To: <email>
 *   [gmailDraft] To filled, pressing Tab to confirm chip
 *   [gmailDraft] filling Subject: <subject>
 *   [gmailDraft] Subject filled
 *   [gmailDraft] filling Body
 *   [gmailDraft] Body filled
 *   [gmailDraft] draft ready — paused before Send
 */

import type { Page } from "playwright";
import { getSessionPage, markSessionIdle } from "../playwrightManager.js";
import { fillInput, type FillInputTarget } from "./fillInput.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ComposeGmailDraftArgs = {
  to: string;
  subject: string;
  body: string;
};

export type ComposeGmailDraftResult = {
  success: boolean;
  status: "draft_ready" | "not_logged_in" | "compose_failed" | "fill_failed" | "error";
  to?: string;
  subject?: string;
  bodyPreview?: string;
  sendReady?: boolean;
  url?: string;
  error?: string;
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

const TO_FIELD_SELECTORS = [
  "input[name='to']",                     // Name attribute (reliable)
  "textarea[name='to']",
  "input[aria-label='To']",
  "input[aria-label='收件人']",
];

const SUBJECT_FIELD_SELECTORS = [
  "input[name='subjectbox']",             // Gmail's stable name attr
  "input[aria-label='Subject']",
  "input[aria-label='主题']",
];

const BODY_FIELD_SELECTORS = [
  "div[aria-label='Message Body']",
  "div[aria-label='邮件正文']",
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

// ── Main task ─────────────────────────────────────────────────────────────────

export async function composeGmailDraft(
  args: ComposeGmailDraftArgs
): Promise<ComposeGmailDraftResult> {
  const { to, subject, body } = args;

  console.log(`[gmailDraft] starting draft — to="${to}" subject="${subject}"`);

  const page = await getSessionPage("gmail");

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

    // Brief pause — let Gmail JS hydrate
    await page.waitForTimeout(2_000);

    const landedUrl = page.url();
    console.log(`[gmailDraft] Gmail opened, url=${landedUrl}`);

    // ── Step 2: Login check ─────────────────────────────────────────────────

    const isLoggedIn =
      landedUrl.includes("mail.google.com") &&
      !landedUrl.includes("accounts.google.com") &&
      !landedUrl.includes("ServiceLogin") &&
      !landedUrl.includes("signin");

    if (!isLoggedIn) {
      console.warn(`[gmailDraft] not logged in — redirected to: ${landedUrl}`);
      markSessionIdle("gmail");
      return {
        success: false,
        status: "not_logged_in",
        url: landedUrl,
        error:
          "Gmail is not logged in. Please open https://mail.google.com in the browser and sign in, then try again.",
      };
    }

    console.log("[gmailDraft] login detected");

    // Wait for inbox to fully load (compose button appears after full load)
    await page
      .waitForSelector(COMPOSE_BTN_SELECTORS[0], { timeout: 15_000 })
      .catch(() => null);

    // ── Step 3: Click Compose ───────────────────────────────────────────────

    console.log("[gmailDraft] clicking Compose…");
    await clickFirst(page, COMPOSE_BTN_SELECTORS);

    // Wait for compose window to open
    let composeWindowSel: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(1_000);
      composeWindowSel = await findFirst(page, COMPOSE_WINDOW_SELECTORS);
      if (composeWindowSel) break;
    }

    if (!composeWindowSel) {
      // Compose may not have recognised selectors but the To input is present
      const toSel = await findFirst(page, TO_FIELD_SELECTORS);
      if (!toSel) {
        console.error("[gmailDraft] compose window did not appear");
        markSessionIdle("gmail");
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

    // Prefer direct selector for Gmail's To input, fall back to placeholder
    const toSel = (await findFirst(page, TO_FIELD_SELECTORS)) ?? TO_FIELD_SELECTORS[0];
    const toTarget: FillInputTarget = { by: "selector", value: toSel };

    const toResult = await fillInput(page, { target: toTarget, value: to, pressEnter: false });
    if (!toResult.success) {
      // Soft failure — try placeholder fallback
      console.warn(`[gmailDraft] To fill via selector failed: ${toResult.error}`);
    }
    // Press Tab to confirm recipient chip (Gmail turns email → chip on Tab)
    try {
      await page.locator(toSel).first().press("Tab");
      console.log("[gmailDraft] To filled, pressed Tab to confirm chip");
    } catch {
      console.warn("[gmailDraft] Tab confirmation for To field failed — continuing");
    }

    // ── Step 5: Fill Subject ────────────────────────────────────────────────

    console.log(`[gmailDraft] filling Subject: ${subject}`);

    const subjectSel =
      (await findFirst(page, SUBJECT_FIELD_SELECTORS)) ?? SUBJECT_FIELD_SELECTORS[0];
    const subjectTarget: FillInputTarget = { by: "selector", value: subjectSel };

    const subjResult = await fillInput(page, {
      target: subjectTarget,
      value: subject,
      pressEnter: false,
    });

    if (subjResult.success) {
      console.log("[gmailDraft] Subject filled");
    } else {
      console.warn(`[gmailDraft] Subject fill warning: ${subjResult.error}`);
    }

    // ── Step 6: Fill Body ───────────────────────────────────────────────────

    console.log("[gmailDraft] filling Body");

    const bodySel =
      (await findFirst(page, BODY_FIELD_SELECTORS)) ?? BODY_FIELD_SELECTORS[0];
    const bodyTarget: FillInputTarget = { by: "selector", value: bodySel };

    const bodyResult = await fillInput(page, {
      target: bodyTarget,
      value: body,
      pressEnter: false,
    });

    if (bodyResult.success) {
      console.log("[gmailDraft] Body filled");
    } else {
      console.warn(`[gmailDraft] Body fill warning: ${bodyResult.error}`);
    }

    // Determine overall success: To + Subject must have been filled
    const overallSuccess =
      (toResult.success || toResult.verified) &&
      (subjResult.success || subjResult.verified);

    if (!overallSuccess) {
      markSessionIdle("gmail");
      return {
        success: false,
        status: "fill_failed",
        to,
        subject,
        bodyPreview: body.slice(0, 100),
        url: page.url(),
        error: `Failed to fill required fields. To: ${toResult.success}, Subject: ${subjResult.success}`,
      };
    }

    console.log("[gmailDraft] draft ready — paused before Send");

    markSessionIdle("gmail");

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
    markSessionIdle("gmail");
    return {
      success: false,
      status: "error",
      url: page.url(),
      error: String(err.message ?? err),
    };
  }
}
