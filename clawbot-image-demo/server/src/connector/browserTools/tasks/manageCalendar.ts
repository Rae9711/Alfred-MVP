/**
 * Task: manageCalendar
 *
 * Opens Google Calendar in the Playwright-managed browser to create or list
 * calendar events by interacting with the UI directly.
 *
 * Logs:
 *  [manageCalendar] action=create title="..."
 *  [manageCalendar] event form filled, leaving open for user review
 */

import { getSessionPage, markSessionIdle } from "../playwrightManager.js";

// ── Types ─────────────────────────────────────────────────

export type ManageCalendarArgs = {
  action: "create" | "list" | "save";
  title?: string;
  date?: string;
  time?: string;
  duration?: string;
  location?: string;
};

export type CalendarEvent = {
  title: string;
  date?: string;
  time?: string;
  location?: string;
};

export type ManageCalendarResult = {
  success: boolean;
  action: string;
  event?: CalendarEvent;
  events?: CalendarEvent[];
  status?: string;
  message?: string;
  error?: string;
  created?: boolean;
  suggestedActions?: Array<{ label: string; tool: string; args?: Record<string, any> }>;
};

// ── Implementation ────────────────────────────────────────

export async function manageCalendar(args: ManageCalendarArgs): Promise<ManageCalendarResult> {
  const action = args.action ?? "list";
  console.log(`[manageCalendar] action=${action}${args.title ? ` title="${args.title}"` : ""}`);

  const page = await getSessionPage("default");

  try {
    if (action === "list") {
      await page.goto("https://calendar.google.com/calendar/r/week", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      if (currentUrl.includes("accounts.google.com")) {
        return {
          success: false,
          action,
          status: "login_required",
          error: "Not logged in to Google Calendar.",
        };
      }

      // Extract visible event chips
      const events = await page.evaluate((): CalendarEvent[] => {
        const chips = Array.from(document.querySelectorAll("[data-eventchip]"));
        return chips.slice(0, 20).map((chip) => ({
          title: (chip as HTMLElement).innerText?.split("\n")[0]?.trim() ?? "",
        }));
      });

      markSessionIdle("default");
      return { success: true, action: "list", events };
    }

    if (action === "create") {
      // Build Google Calendar new-event URL with optional date prefill
      const datePart = args.date?.replace(/-/g, "") ?? "";
      const url = datePart
        ? `https://calendar.google.com/calendar/r/eventedit?dates=${datePart}/${datePart}`
        : "https://calendar.google.com/calendar/r/eventedit";

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      if (currentUrl.includes("accounts.google.com")) {
        return {
          success: false,
          action,
          status: "login_required",
          error: "Not logged in to Google Calendar.",
        };
      }

      // Fill event title
      if (args.title) {
        const titleSel = [
          '[data-testid="title-input"]',
          'input[placeholder="Title"]',
          '[aria-label="Title"]',
          'input[aria-label="Add title"]',
        ].join(", ");

        try {
          const titleInput = await page.waitForSelector(titleSel, { timeout: 10000 });
          await titleInput.click();
          await titleInput.fill(args.title);
          console.log(`[manageCalendar] filled title: "${args.title}"`);
        } catch {
          console.warn("[manageCalendar] could not find title input");
        }
      }

      // Fill location if provided
      if (args.location) {
        const locationSel = [
          '[data-testid="location-input"]',
          'input[aria-label="Add location"]',
          'input[placeholder*="location" i]',
        ].join(", ");

        const locationInput = await page.$(locationSel);
        if (locationInput) {
          await locationInput.fill(args.location);
        }
      }

      // Leave form open for user review — don't click Save
      console.log("[manageCalendar] event form filled, leaving open for user review");

      return {
        success: true,
        action: "create",
        status: "form_ready",
        message:
          "Google Calendar is open with the event details filled in. Review and click Save when ready.",
        event: {
          title: args.title ?? "",
          date: args.date,
          time: args.time,
          location: args.location,
        },
        suggestedActions: [
          {
            label: "Save this calendar event",
            tool: "browser.manage_calendar",
            args: { action: "save" },
          },
        ],
      };
    }

    if (action === "save") {
      // Attempt to click the Save button on the event form and verify creation
      console.log(`[manageCalendar] attempting to Save event`);

      // Common selectors for Save button
      const saveSelectors = [
        'button:has-text("Save")',
        'div[role="button"]:has-text("Save")',
        'button[aria-label="Save"]',
        '[data-testid="save-button"]',
      ];

      let clicked = false;
      for (const sel of saveSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            clicked = true;
            console.log(`[manageCalendar] clicked Save using selector: ${sel}`);
            break;
          }
        } catch (e) {
          // ignore and try next
        }
      }

      if (!clicked) {
        // Could not find Save button
        markSessionIdle("default");
        return {
          success: false,
          action: "save",
          status: "save_failed",
          error: "Could not find Save button on the event form.",
        };
      }

      // Wait briefly for the save to process
      await page.waitForTimeout(2000);

      // Verify by checking for the event title in the week view
      try {
        await page.goto("https://calendar.google.com/calendar/r/week", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(1500);

        const found = await page.evaluate((title?: string) => {
          if (!title) return false;
          const chips = Array.from(document.querySelectorAll("[data-eventchip], .rSoRzd, .lvV7Fc"));
          return chips.some((c) => (c as HTMLElement).innerText?.includes(title));
        }, args.title);

        markSessionIdle("default");

        if (found) {
          return {
            success: true,
            action: "save",
            status: "created",
            created: true,
            event: { title: args.title ?? "" },
            message: "Event saved and verified in calendar.",
          };
        }

        return {
          success: true,
          action: "save",
          status: "created_not_verified",
          created: false,
          message: "Save clicked but could not verify event in calendar.",
        };
      } catch (e: any) {
        markSessionIdle("default");
        return {
          success: false,
          action: "save",
          status: "created_error",
          error: e?.message ?? String(e),
        };
      }
    }

    return { success: false, action, error: `Unknown action: ${action}` };
  } catch (e: any) {
    markSessionIdle("default");
    const msg = e?.message ?? String(e);
    console.error("[manageCalendar] error:", msg);
    return { success: false, action, error: msg };
  }
}
