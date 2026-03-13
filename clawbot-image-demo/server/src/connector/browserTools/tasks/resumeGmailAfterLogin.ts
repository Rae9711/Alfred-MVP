/**
 * Task: resumeGmailAfterLogin
 *
 * Resumes a paused Gmail compose workflow after the user has manually signed in.
 *
 * Called when the user clicks the "I have signed in, continue" button that
 * was rendered after a login_required result from browser.compose_gmail_draft.
 *
 * Execution flow:
 *   1. Ensure we are on mail.google.com (navigate if needed)
 *   2. Re-check login state (URL + DOM signals — same logic as composeGmailDraft)
 *   3a. If STILL not signed in → return login_required again with same suggestedActions
 *   3b. If signed in → run the full compose workflow (delegate to composeGmailDraft)
 *
 * Safety rules:
 *   - NEVER automates password entry or login
 *   - NEVER clicks Send automatically
 *   - Always stops before Send
 *
 * Logs:
 *   [resumeGmail] called with to=... subject=...
 *   [resumeGmail] current url=...
 *   [resumeGmail] login state check started
 *   [resumeGmail] login detected: true/false (signal: <which>)
 *   [resumeGmail] delegating to composeGmailDraft
 *   [resumeGmail] still not signed in — returning login_required
 */

import type { Page } from "playwright";
import { getSessionPage } from "../playwrightManager.js";
import { composeGmailDraft } from "./composeGmailDraft.js";
import type { ComposeGmailDraftArgs, ComposeGmailDraftResult } from "./composeGmailDraft.js";

// DOM selector for the Gmail Compose button — quickest indicator of inbox load
const COMPOSE_BTN_SELECTOR = "div[gh='cm']";

async function checkGmailLoginState(page: Page): Promise<{ isLoggedIn: boolean; signal: string; url: string }> {
  // Ensure we are on Gmail (navigate only if we drifted away)
  const currentUrl = page.url();
  if (!currentUrl.includes("mail.google.com")) {
    console.log("[resumeGmail] not on Gmail, navigating…");
    await page.goto("https://mail.google.com", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(2_500);
  } else {
    // Already on Gmail — give it a tick to finish any pending redirect
    await page.waitForTimeout(1_500);
  }

  const landedUrl = page.url();

  const urlSignal =
    landedUrl.includes("mail.google.com") &&
    !landedUrl.includes("accounts.google.com") &&
    !landedUrl.includes("ServiceLogin") &&
    !landedUrl.includes("/signin") &&
    !landedUrl.includes("CheckCookie");

  let signal = "url";
  let isLoggedIn = urlSignal;

  if (urlSignal) {
    const composeVisible = await page
      .locator(COMPOSE_BTN_SELECTOR)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (composeVisible) {
      signal = "compose-button-visible";
    } else {
      const navVisible = await page
        .locator("div[role='navigation']")
        .first()
        .isVisible({ timeout: 3_000 })
        .catch(() => false);
      if (navVisible) {
        signal = "mailbox-nav-visible";
      } else {
        isLoggedIn = false;
        signal = "dom-check-failed";
      }
    }
  }

  return { isLoggedIn, signal, url: landedUrl };
}

export async function resumeGmailAfterLogin(
  args: ComposeGmailDraftArgs
): Promise<ComposeGmailDraftResult> {
  const { to, subject, body } = args;
  console.log(`[resumeGmail] called — to="${to}" subject="${subject}"`);

  const page = await getSessionPage("gmail");

  const currentUrl = page.url();
  console.log(`[resumeGmail] current url=${currentUrl}`);
  console.log("[resumeGmail] login state check started");

  const { isLoggedIn, signal, url } = await checkGmailLoginState(page);
  console.log(`[resumeGmail] login detected: ${isLoggedIn} (signal: ${signal})`);

  if (!isLoggedIn) {
    console.warn(`[resumeGmail] still not signed in — url=${url}`);
    // Return login_required again — keep browser open for another attempt
    return {
      success: false,
      status: "login_required",
      site: "gmail",
      message: "Still not signed in to Gmail. Please sign in and try again.",
      url,
      suggestedActions: [
        {
          tool: "browser.resume_gmail_after_login",
          label: "I have signed in, continue",
          args: { to, subject, body },
        },
      ],
    };
  }

  // Signed in — delegate to composeGmailDraft which handles Compose + fill
  console.log("[resumeGmail] delegating to composeGmailDraft");
  return composeGmailDraft({ to, subject, body });
}
