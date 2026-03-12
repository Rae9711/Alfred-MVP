/**
 * Task: fillInput
 *
 * Fills a visible input / textarea / contenteditable field on the current page.
 * Exported as fillInput() so higher-level workflows (Gmail, ChatGPT, etc.) can call it directly.
 *
 * Target locator modes:
 *   label       – find by associated <label> text  (page.getByLabel)
 *   placeholder – find by placeholder attribute    (page.getByPlaceholder)
 *   selector    – find by CSS / XPath selector     (page.locator)
 *   roleText    – find by ARIA accessible name     (tries textbox → searchbox → combobox)
 *
 * Execution:
 *   1. Resolve locator → wait for visible + enabled
 *   2. Detect field type (input / textarea / contenteditable)
 *   3. Focus + clear (Playwright fill already clears, but we triple-click for contenteditable)
 *   4. Fill value (page.fill for standard; type char-by-char fallback for contenteditable)
 *   5. Press Enter if requested
 *   6. Verify: read back DOM value and compare with input
 *
 * Logs:
 *   [fillInput] target mode: <mode>  target value: <value>
 *   [fillInput] element found
 *   [fillInput] field type: input|textarea|contenteditable
 *   [fillInput] clear strategy: fill|triple-click
 *   [fillInput] value entered
 *   [fillInput] verification: readback="..." match=true/false
 */

import type { Page, Locator } from "playwright";
import { getMostRecentSessionPage } from "../playwrightManager.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type FillInputTarget = {
  by: "label" | "placeholder" | "selector" | "roleText";
  value: string;
};

export type FillInputArgs = {
  target: FillInputTarget;
  value: string;
  pressEnter?: boolean; // default false
};

export type FieldType = "input" | "textarea" | "contenteditable" | "unknown";

export type FillInputResult = {
  success: boolean;
  target: FillInputTarget;
  valuePreview: string;   // first 100 chars of the entered value
  fieldType: FieldType;
  verified: boolean;
  url: string;
  error?: string;
};

// ── Locator resolution ────────────────────────────────────────────────────────

/**
 * Returns a Playwright Locator for the given target descriptor.
 * For `roleText` we chain .or() across all text-input ARIA roles so the first
 * visible match is used regardless of which role the element declares.
 */
function resolveLocator(page: Page, target: FillInputTarget): Locator {
  switch (target.by) {
    case "label":
      return page.getByLabel(target.value, { exact: false });

    case "placeholder":
      return page.getByPlaceholder(target.value, { exact: false });

    case "selector":
      return page.locator(target.value);

    case "roleText":
      return page
        .getByRole("textbox", { name: target.value, exact: false })
        .or(page.getByRole("searchbox", { name: target.value, exact: false }))
        .or(page.getByRole("combobox", { name: target.value, exact: false }));
  }
}

// ── Field-type detection ──────────────────────────────────────────────────────

async function detectFieldType(locator: Locator): Promise<FieldType> {
  return locator.evaluate((el: Element): FieldType => {
    if ((el as HTMLElement).isContentEditable) return "contenteditable";
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "input") return "input";
    return "unknown";
  });
}

// ── Fill strategies ───────────────────────────────────────────────────────────

/**
 * Standard fill for <input> and <textarea>.
 * Playwright's fill() clears existing content, types the value, and dispatches
 * input + change events — works for both plain and React/controlled inputs.
 */
async function fillStandard(locator: Locator, value: string): Promise<void> {
  console.log("[fillInput] clear strategy: fill (standard)");
  await locator.fill(value);
}

/**
 * Contenteditable fill.
 * Triple-click selects all existing content, then we type char-by-char via
 * keyboard to trigger framework listeners. Falls back to locator.fill() if
 * typing leaves the element empty.
 */
async function fillContentEditable(locator: Locator, value: string): Promise<void> {
  console.log("[fillInput] clear strategy: triple-click (contenteditable)");
  await locator.click({ clickCount: 3 }); // select all
  await locator.press("Backspace");        // clear selection

  // Playwright's fill() works on contenteditable since Playwright v1.14.
  // However, some rich-text editors (Quill, Slate, ProseMirror) need actual
  // key events. Try fill first; verify later will catch if it didn't stick.
  try {
    await locator.fill(value);
  } catch {
    // Fallback: type char-by-char
    console.log("[fillInput] fill() failed for contenteditable — falling back to type");
    await locator.click({ clickCount: 3 });
    await locator.press("Backspace");
    await locator.type(value, { delay: 20 });
  }
}

// ── Value readback ────────────────────────────────────────────────────────────

async function readback(locator: Locator, fieldType: FieldType): Promise<string> {
  if (fieldType === "contenteditable") {
    return locator.evaluate(
      (el: Element) =>
        ((el as HTMLElement).innerText ?? (el as HTMLElement).textContent ?? "").trim()
    );
  }
  // input | textarea | unknown
  return (await locator.inputValue()).trim();
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Fills a field on `page` with `args.value`.
 * Exported for direct reuse by higher-level workflows (e.g. gmailDraft, chatgptSubmit).
 */
export async function fillInput(
  page: Page,
  args: FillInputArgs
): Promise<FillInputResult> {
  const { target, value, pressEnter = false } = args;
  const valuePreview = value.slice(0, 100);
  const url = page.url();

  console.log(`[fillInput] target mode: ${target.by}  target value: "${target.value}"`);

  let fieldType: FieldType = "unknown";

  try {
    const locator = resolveLocator(page, target);

    // Wait up to 10 s for the element to be visible and enabled
    await locator.first().waitFor({ state: "visible", timeout: 10_000 });

    // If the locator matches multiple elements, use the first visible one
    const el = locator.first();

    fieldType = await detectFieldType(el);
    console.log(`[fillInput] element found`);
    console.log(`[fillInput] field type: ${fieldType}`);

    // Focus the element
    await el.focus();

    // Fill by strategy
    if (fieldType === "contenteditable") {
      await fillContentEditable(el, value);
    } else {
      await fillStandard(el, value);
    }

    console.log("[fillInput] value entered");

    // Brief stabilisation pause (lets React/Vue reconcilers commit state)
    await page.waitForTimeout(350);

    // Press Enter if requested (do this AFTER reading back, as Enter may navigate away)
    // But we verify first to capture the state before potential navigation
    const rb = await readback(el, fieldType);
    const verified = rb.trimEnd() === value.trimEnd() || rb.includes(value) || value.includes(rb.trimEnd());
    console.log(`[fillInput] verification: readback="${rb.slice(0, 80)}" match=${verified}`);

    if (pressEnter) {
      await el.press("Enter");
    }

    return {
      success: true,
      target,
      valuePreview,
      fieldType,
      verified,
      url,
    };
  } catch (err: any) {
    console.error(`[fillInput] error: ${err.message}`);
    return {
      success: false,
      target,
      valuePreview,
      fieldType,
      verified: false,
      url,
      error: String(err.message ?? err),
    };
  }
}

// ── Tool entrypoint (connector dispatcher calls this) ─────────────────────────

/**
 * Entrypoint called by the browser tool dispatcher.
 * Grabs the most recent session page, then delegates to fillInput().
 */
export async function fillInputTool(args: FillInputArgs): Promise<FillInputResult> {
  const { page } = await getMostRecentSessionPage();
  return fillInput(page, args);
}
