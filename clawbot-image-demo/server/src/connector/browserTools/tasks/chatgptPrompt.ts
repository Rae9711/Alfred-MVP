/**
 * Task: chatgptPrompt
 *
 * Opens ChatGPT in the Playwright browser, fills the prompt input using the
 * reusable fillInput() helper, submits it, waits for the full response to
 * complete streaming, and extracts the visible assistant response text.
 *
 * Execution flow:
 *   1. Navigate to https://chatgpt.com (reuse page if already there)
 *   2. Detect login — if not logged in, return clear error
 *   3. Wait for prompt input to be ready
 *   4. Fill prompt via fillInput()
 *   5. Submit (click Send button, fallback to Enter key)
 *   6. Wait for streaming to complete (stop button disappears / response stabilises)
 *   7. Extract latest assistant message text
 *   8. Return structured result
 *
 * Logs:
 *   [chatgptPrompt] navigating to ChatGPT…
 *   [chatgptPrompt] already on ChatGPT, reusing page
 *   [chatgptPrompt] login detected / not logged in
 *   [chatgptPrompt] prompt box found
 *   [chatgptPrompt] prompt filled
 *   [chatgptPrompt] prompt submitted
 *   [chatgptPrompt] waiting for response…
 *   [chatgptPrompt] response streaming complete
 *   [chatgptPrompt] response extracted, length=<n>
 */

import type { Page } from "playwright";
import { getSessionPage, markSessionIdle } from "../playwrightManager.js";
import { fillInput, type FillInputTarget } from "./fillInput.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ChatGPTPromptArgs = {
  prompt: string;
};

export type ChatGPTPromptResult = {
  success: boolean;
  promptPreview?: string;
  response?: string;
  truncated?: boolean;
  url?: string;
  error?: string;
};

// ── Selector constants ────────────────────────────────────────────────────────

/**
 * ChatGPT prompt input — contenteditable div in current UI.
 * Tried in order, first visible match wins.
 */
const PROMPT_INPUT_SELECTORS = [
  "#prompt-textarea",                          // Modern ChatGPT (primary, stable id)
  "div[contenteditable='true'][id='prompt-textarea']",
  "textarea[data-id='root']",                 // Older API-based layout
  "div[contenteditable='true'][tabindex='0']", // Generic contenteditable fallback
  "textarea#prompt-textarea",                 // Textarea variant
];

/**
 * Send/submit button selectors.
 */
const SEND_BTN_SELECTORS = [
  "button[data-testid='send-button']",        // Reliable data-testid
  "button[aria-label='Send prompt']",
  "button[aria-label='发送']",
  "button.send-button",
  "[data-testid='fruitjuice-send-button']",   // Older variant
];

/**
 * "Stop generating" button — indicates streaming is in progress.
 * We wait for this to disappear to know streaming is done.
 */
const STOP_BTN_SELECTORS = [
  "button[data-testid='stop-button']",
  "button[aria-label='Stop generating']",
  "button[aria-label='停止生成']",
];

/**
 * Assistant message container selectors — we read the last one after streaming.
 */
const RESPONSE_SELECTORS = [
  "[data-message-author-role='assistant']",    // Stable role attribute
  ".agent-turn",                               // Older layout
  "div.group\\/conversation-turn[data-testid*='conversation-turn']",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isVisible(page: Page, selector: string, timeout = 2_000): Promise<boolean> {
  try {
    return await page
      .locator(selector)
      .first()
      .isVisible({ timeout });
  } catch {
    return false;
  }
}

async function findFirstVisible(page: Page, selectors: string[]): Promise<string | null> {
  for (const sel of selectors) {
    if (await isVisible(page, sel)) return sel;
  }
  return null;
}

// ── Main task ─────────────────────────────────────────────────────────────────

export async function chatgptPrompt(
  args: ChatGPTPromptArgs
): Promise<ChatGPTPromptResult> {
  const { prompt } = args;
  const promptPreview = prompt.slice(0, 200);

  console.log(`[chatgptPrompt] starting — prompt="${promptPreview.slice(0, 80)}…"`);

  const page = await getSessionPage("chatgpt");

  try {
    // ── Step 1: Navigate to ChatGPT ─────────────────────────────────────────

    const currentUrl = page.url();
    const alreadyOnChatGPT =
      currentUrl.includes("chatgpt.com") || currentUrl.includes("chat.openai.com");

    if (!alreadyOnChatGPT) {
      console.log("[chatgptPrompt] navigating to ChatGPT…");
      await page.goto("https://chatgpt.com", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } else {
      console.log("[chatgptPrompt] already on ChatGPT, reusing page");
    }

    // Wait for JS hydration
    await page.waitForTimeout(2_500);
    const landedUrl = page.url();
    console.log(`[chatgptPrompt] ChatGPT page opened, url=${landedUrl}`);

    // ── Step 2: Login check ─────────────────────────────────────────────────

    const notLoggedIn =
      landedUrl.includes("auth.openai.com") ||
      landedUrl.includes("accounts.google.com") ||
      landedUrl.includes("/auth/login") ||
      landedUrl.includes("login");

    if (notLoggedIn) {
      console.warn(`[chatgptPrompt] not logged in — redirected to: ${landedUrl}`);
      markSessionIdle("chatgpt");
      return {
        success: false,
        url: landedUrl,
        error:
          "ChatGPT is not logged in. Please open https://chatgpt.com in the browser and sign in, then try again.",
      };
    }

    console.log("[chatgptPrompt] login detected");

    // ── Step 3: Locate prompt input ──────────────────────────────────────────

    // Wait up to 15 s for the prompt textarea to appear
    let promptSel: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      promptSel = await findFirstVisible(page, PROMPT_INPUT_SELECTORS);
      if (promptSel) break;
      await page.waitForTimeout(2_000);
    }

    if (!promptSel) {
      console.error("[chatgptPrompt] prompt box not found");
      markSessionIdle("chatgpt");
      return {
        success: false,
        url: page.url(),
        error:
          "Could not find the ChatGPT prompt input. The page may not have loaded correctly or the UI has changed.",
      };
    }

    console.log(`[chatgptPrompt] prompt box found (selector: ${promptSel})`);

    // ── Step 4: Fill prompt ──────────────────────────────────────────────────

    const promptTarget: FillInputTarget = { by: "selector", value: promptSel };

    const fillResult = await fillInput(page, {
      target: promptTarget,
      value: prompt,
      pressEnter: false, // we submit via Send button below
    });

    if (!fillResult.success && !fillResult.verified) {
      console.warn(`[chatgptPrompt] prompt fill warning: ${fillResult.error}`);
      // Don't abort — some contenteditable fills "succeed" with verified=false but text is present
    }

    console.log("[chatgptPrompt] prompt filled");

    // Brief pause to let the Send button become active (it's disabled when input is empty)
    await page.waitForTimeout(500);

    // ── Step 5: Submit ───────────────────────────────────────────────────────

    // Try clicking the Send button
    const sendSel = await findFirstVisible(page, SEND_BTN_SELECTORS);

    if (sendSel) {
      console.log(`[chatgptPrompt] clicking Send button (${sendSel})`);
      await page.locator(sendSel).first().click();
    } else {
      // Fallback: press Enter on the prompt input
      console.log("[chatgptPrompt] Send button not found — pressing Enter on input");
      await page.locator(promptSel).first().press("Enter");
    }

    console.log("[chatgptPrompt] prompt submitted");

    // ── Step 6: Wait for response ────────────────────────────────────────────

    console.log("[chatgptPrompt] waiting for response…");

    // First wait for the Stop button to appear (streaming started)
    const stopSel = STOP_BTN_SELECTORS[0];
    try {
      await page.waitForSelector(stopSel, { timeout: 15_000 });
      console.log("[chatgptPrompt] streaming started (Stop button visible)");

      // Now wait for the Stop button to disappear (streaming done)
      await page.waitForSelector(stopSel, { state: "hidden", timeout: 120_000 });
      console.log("[chatgptPrompt] response streaming complete");
    } catch {
      // Stop button may never appear for short responses, or selector may have changed.
      // Fall back to a fixed wait and then attempt extraction anyway.
      console.warn("[chatgptPrompt] could not detect stream via Stop button — waiting 8 s");
      await page.waitForTimeout(8_000);
    }

    // Extra stability pause — let React commit final text
    await page.waitForTimeout(1_000);

    // ── Step 7: Extract response ─────────────────────────────────────────────

    let responseText = "";

    for (const sel of RESPONSE_SELECTORS) {
      try {
        const nodes = page.locator(sel);
        const count = await nodes.count();
        if (count === 0) continue;

        // Take the last assistant message
        const last = nodes.last();

        // Prefer .innerText for rendered text (strips markdown HTML but keeps readable text)
        responseText = await last.evaluate((el: Element) =>
          ((el as HTMLElement).innerText ?? el.textContent ?? "").trim()
        );

        if (responseText.length > 0) break;
      } catch {
        continue;
      }
    }

    if (!responseText) {
      console.warn("[chatgptPrompt] could not extract response text");
      markSessionIdle("chatgpt");
      return {
        success: false,
        promptPreview,
        url: page.url(),
        error:
          "Response was submitted but could not extract the assistant's reply. The UI may have changed.",
      };
    }

    const MAX_RESPONSE = 4_000; // chars
    const truncated = responseText.length > MAX_RESPONSE;
    const finalResponse = truncated ? responseText.slice(0, MAX_RESPONSE) + "\n\n[... truncated]" : responseText;

    console.log(
      `[chatgptPrompt] response extracted, length=${responseText.length}${truncated ? " (truncated)" : ""}`
    );

    markSessionIdle("chatgpt");

    return {
      success: true,
      promptPreview,
      response: finalResponse,
      truncated,
      url: page.url(),
    };
  } catch (err: any) {
    console.error(`[chatgptPrompt] unexpected error: ${err.message}`);
    markSessionIdle("chatgpt");
    return {
      success: false,
      promptPreview,
      url: page.url(),
      error: String(err.message ?? err),
    };
  }
}
