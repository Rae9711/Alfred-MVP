/**
 * Task: readGmail
 *
 * Opens Gmail in the Playwright-managed browser, reads the inbox,
 * and extracts the most recent emails with sender, subject, date, and preview.
 *
 * Logs:
 *  [readGmail] reading inbox, count=<n>
 *  [readGmail] extracted <n> emails
 */

import { getSessionPage, markSessionIdle } from "../playwrightManager.js";

// ── Types ─────────────────────────────────────────────────

export type ReadGmailArgs = {
  count?: number;
  query?: string;
};

export type GmailEmail = {
  from: string;
  subject: string;
  date: string;
  preview: string;
  unread: boolean;
};

export type ReadGmailResult = {
  success: boolean;
  emails: GmailEmail[];
  count: number;
  query?: string;
  error?: string;
  status?: string;
};

// ── Implementation ────────────────────────────────────────

export async function readGmail(args: ReadGmailArgs): Promise<ReadGmailResult> {
  const count = Math.min(args.count ?? 5, 20);
  const query = (args.query ?? "").trim();

  console.log(`[readGmail] reading inbox, count=${count}${query ? `, query="${query}"` : ""}`);

  const page = await getSessionPage("default");

  try {
    const url = query
      ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`
      : "https://mail.google.com/mail/u/0/#inbox";

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Give Gmail time to load dynamic content
    await page.waitForTimeout(2500);

    // Check login state
    const currentUrl = page.url();
    if (
      currentUrl.includes("accounts.google.com") ||
      currentUrl.includes("signin/") ||
      currentUrl.includes("ServiceLogin")
    ) {
      return {
        success: false,
        emails: [],
        count: 0,
        status: "login_required",
        error: "Not logged in to Gmail. Please sign in first.",
      };
    }

    // Wait for inbox rows
    try {
      await page.waitForSelector('tr.zA', { timeout: 12000 });
    } catch {
      // May be empty inbox or alternate layout
    }

    // Extract email rows via DOM evaluation
    const emails = await page.evaluate((maxCount: number): GmailEmail[] => {
      const rows = Array.from(document.querySelectorAll("tr.zA")).slice(0, maxCount);
      return rows.map((row) => {
        const fromEl = row.querySelector(".yX") as HTMLElement;
        const subjectEl =
          (row.querySelector(".bog") as HTMLElement) ??
          (row.querySelector(".y6") as HTMLElement);
        const previewEl = row.querySelector(".y2") as HTMLElement;
        const dateEl =
          (row.querySelector(".xW.xY span") as HTMLElement) ??
          (row.querySelector(".G3") as HTMLElement);

        return {
          from: fromEl?.innerText?.trim() ?? "",
          subject: subjectEl?.innerText?.trim() ?? "(No subject)",
          preview: previewEl?.innerText?.trim() ?? "",
          date: dateEl?.getAttribute("title") ?? dateEl?.innerText?.trim() ?? "",
          unread: row.classList.contains("zE"),
        };
      });
    }, count);

    console.log(`[readGmail] extracted ${emails.length} emails`);

    markSessionIdle("default");

    return {
      success: true,
      emails,
      count: emails.length,
      ...(query ? { query } : {}),
    };
  } catch (e: any) {
    markSessionIdle("default");
    const msg = e?.message ?? String(e);
    console.error("[readGmail] error:", msg);
    return { success: false, emails: [], count: 0, error: msg };
  }
}
