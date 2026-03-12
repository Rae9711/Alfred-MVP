/**
 * Google Flights Search Task
 *
 * Navigation strategy:
 *  1. Build the deep-link URL (hash format) as a first fast attempt.
 *  2. After navigation, check if we landed on a results page within 3 s.
 *  3. If NOT on results (Google dropped us on explore/home), fall back to
 *     UI form-fill: origin → destination → date → search button.
 *  4. Extract flight cards from the results page.
 *
 * Logs emitted:
 *  [searchFlights] strategy="deep-link"|"ui-fallback"
 *  [searchFlights] finalUrl=<url>
 *  [searchFlights] resultsPageReached=true|false
 */

import path from "path";
import fs from "fs";
import { Page } from "playwright";
import { getSessionPage, markSessionIdle, resetSession } from "../playwrightManager.js";
import {
  resolveAirportCode,
  getDefaultDate,
} from "../utils/airportCodes.js";
import { GOOGLE_FLIGHTS_SELECTORS } from "../selectors/googleFlights.js";

// ── Types ────────────────────────────────────────────────

export type SearchFlightsArgs = {
  origin: string;
  destination: string;
  date?: string;       // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD (optional, round-trip)
};

export type FlightResult = {
  airline: string;
  departure: string;
  arrival: string;
  duration: string;
  stops: string;
  price: string;
};

export type SearchFlightsResult = {
  success: boolean;
  searchUrl: string | null;
  searchParams?: {
    origin: string;
    destination: string;
    date: string;
    returnDate?: string;
  };
  flights?: FlightResult[];
  warnings?: string[];
  extractionWarnings?: string[];
  resultsPageVerification?: {
    finalUrl: string;
    selectorMatched: string | null;
    visibleFlightCards: number;
    resultsPageReached: boolean;
  };
  error?: string;
  resolutionFailure?: {
    field: "origin" | "destination";
    input: string;
    suggestions: string[];
  };
  pageState?: "preserved" | "closed";
  navigationStrategy?: "deep-link" | "ui-fallback";
};

// ── Debug / screenshot helpers ───────────────────────────

const DEBUG_DIR = path.join(process.cwd(), "debug-screenshots");

async function debugShot(page: Page, label: string): Promise<void> {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const ts = Date.now();
    const file = path.join(DEBUG_DIR, `${ts}__${label.replace(/[^a-z0-9_-]/gi, "_")}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[screenshot] saved: ${file}`);
  } catch (e) {
    console.warn(`[screenshot] failed "${label}":`, (e as Error).message);
  }
}

async function logDomState(page: Page, label: string): Promise<void> {
  try {
    const info = await page.evaluate(() => {
      const originInput = document.querySelector<HTMLInputElement>('input[placeholder="Where from?"]');
      const destInput   = document.querySelector<HTMLInputElement>('input[placeholder="Where to?"]');
      const dateInput   = document.querySelector<HTMLInputElement>(
        'input[placeholder="Departure"], input[placeholder="Departure date"], input[placeholder*="Departure"]',
      );
      const tripTypeEl  = document.querySelector<HTMLElement>('[data-veub]');
      const searchBtn   = document.querySelector<HTMLButtonElement>('button[aria-label="Search"]');
      const options     = Array.from(document.querySelectorAll('li[role="option"]'))
        .map(el => el.textContent?.trim().substring(0, 70))
        .filter(Boolean)
        .slice(0, 8);
      const calendarDays = Array.from(
        document.querySelectorAll('td[data-iso], td[aria-label*="March"], td[aria-label*="April"]'),
      ).map(el => el.getAttribute("data-iso") || el.getAttribute("aria-label") || "").slice(0, 5);

      return {
        originValue: originInput?.value || "(empty)",
        originVisible: !!originInput,
        destValue: destInput?.value || "(empty)",
        destVisible: !!destInput,
        dateValue: dateInput?.value || "(empty)",
        dateVisible: !!dateInput,
        tripType: tripTypeEl?.innerText?.trim() || "(not found)",
        searchBtnEnabled: searchBtn ? !searchBtn.disabled : null,
        autocompleteOptions: options,
        calendarDays,
        url: location.href.substring(0, 100),
      };
    });
    console.log(`[dom-state][${label}]:`, JSON.stringify(info));
  } catch (e) {
    console.warn(`[dom-state] error for "${label}":`, (e as Error).message);
  }
}

// ── Consent dismissal ────────────────────────────────────

async function dismissConsent(page: Page): Promise<void> {
  const sels = [
    'button[aria-label*="Accept all"]',
    'button[jsname="b3VHJd"]',
    'form[action*="consent"] button:last-child',
  ];
  for (const sel of sels) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await page.waitForTimeout(800);
        console.log(`[ui-fallback] ✓ Dismissed consent via "${sel}"`);
        return;
      }
    } catch { continue; }
  }
}

// ── Step 1 & 2: Set trip type to one-way (working prototype logic) ──

async function setOneWay(page: Page): Promise<boolean> {
  console.log("[ui-fallback] setOneWay — setting trip type to one-way...");

  // Try multiple selectors to find the trip type button
  const selectors = [
    'button:has-text("Round trip")',
    '[aria-label*="Round trip"]',
    '[aria-label*="Trip type"]',
    '[jsname]:has-text("Round trip")',
  ];

  let clicked = false;
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(1000);
        console.log(`[ui-fallback]   Clicked trip type button via "${sel}"`);
        clicked = true;
        break;
      }
    } catch { continue; }
  }

  if (!clicked) {
    console.warn("[ui-fallback] ⚠ Trip type button not found — may already be one-way");
    return true; // non-blocking
  }

  await debugShot(page, "01_trip_menu_open");

  // Click "One way" option using JavaScript evaluate for reliability
  const oneWayClicked = await page.evaluate(() => {
    const allOptions = Array.from(document.querySelectorAll('[role="option"]'));
    for (let i = 0; i < allOptions.length; i++) {
      const text = allOptions[i].textContent?.toLowerCase() || '';
      if (text.includes('one way')) {
        (allOptions[i] as HTMLElement).click();
        return { success: true, index: i, text: allOptions[i].textContent };
      }
    }
    return { success: false, index: -1, text: null };
  });

  if (oneWayClicked.success) {
    await page.waitForTimeout(800);
    console.log(`[ui-fallback] ✓ One way selected at index ${oneWayClicked.index}`);
    await debugShot(page, "02_after_oneway");
    return true;
  }

  console.warn("[ui-fallback] ⚠ One way option not found in dropdown");
  return false;
}

async function getResultsPageVerification(page: Page): Promise<{
  finalUrl: string;
  selectorMatched: string | null;
  visibleFlightCards: number;
  resultsPageReached: boolean;
}> {
  const finalUrl = page.url();

  let selectorMatched: string | null = null;
  for (const sel of RESULTS_PAGE_SIGNALS) {
    try {
      const el = await page.$(sel);
      if (el) {
        selectorMatched = sel;
        break;
      }
    } catch {
      continue;
    }
  }

  const visibleFlightCards = await page.evaluate(`(function(){
    var nodes = Array.from(document.querySelectorAll('[role="listitem"], li, [data-result-index], .gws-flights-results__result-item'));
    var count = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var rect = el.getBoundingClientRect();
      var txt = (el.innerText || '');
      if (rect.width > 0 && rect.height > 0 && /\\$\\d+/.test(txt) && /\\d{1,2}:\\d{2}\\s*[AP]M/i.test(txt)) {
        count++;
      }
    }
    return count;
  })()`).catch(() => 0) as number;

  const resultsPageReached = !!selectorMatched || RESULTS_URL_PATTERN.test(finalUrl);
  return { finalUrl, selectorMatched, visibleFlightCards, resultsPageReached };
}

// ── Steps 3 & 4: Set origin / destination (working prototype logic) ──

async function setLocationField(
  page: Page,
  fieldType: "origin" | "destination",
  cityQuery: string,
  screenshotPrefix: string,
): Promise<boolean> {
  const isOrigin = fieldType === "origin";
  const ariaLabel = isOrigin ? "Where from?" : "Where to?";
  console.log(`[ui-fallback] set${isOrigin ? "Origin" : "Destination"}("${cityQuery}")`);

  // Find input field
  const selectors = [
    `input[aria-label="${ariaLabel}"]`,
    `input[placeholder="${ariaLabel}"]`,
    isOrigin ? 'input[aria-label*="from"]' : 'input[aria-label*="to"]',
  ];

  let input = null;
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        input = el;
        console.log(`[ui-fallback]   Found input via "${sel}"`);
        break;
      }
    } catch { continue; }
  }

  if (!input) {
    console.error(`[ui-fallback] ✗ ${fieldType} input not found`);
    await debugShot(page, `${screenshotPrefix}_FAIL_no_input`);
    return false;
  }

  // Clear field using multiple strategies (matching working prototype)
  await debugShot(page, `${screenshotPrefix}_00_before_clear`);
  
  // Strategy 1: Playwright's clear() method
  console.log(`[ui-fallback]   Strategy 1: Using clear() method...`);
  await input.clear();
  await page.waitForTimeout(500);
  
  let currentValue = await input.inputValue().catch(() => '');
  console.log(`[ui-fallback]   After clear(): value="${currentValue}"`);
  
  // Strategy 2: If still has value, use triple-click + backspace
  if (currentValue.length > 0) {
    console.log(`[ui-fallback]   Strategy 2: Triple-click and backspace...`);
    await input.click({ clickCount: 3, force: true });
    await page.waitForTimeout(300);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    
    currentValue = await input.inputValue().catch(() => '');
    console.log(`[ui-fallback]   After backspace: value="${currentValue}"`);
  }
  
  // Strategy 3: If STILL has value, use Ctrl+A and Delete
  if (currentValue.length > 0) {
    console.log(`[ui-fallback]   Strategy 3: Ctrl+A and Delete...`);
    await input.click({ force: true });
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(400);
    
    currentValue = await input.inputValue().catch(() => '');
    console.log(`[ui-fallback]   After Ctrl+A Delete: value="${currentValue}"`);
  }
  
  const cleared = currentValue.length === 0;
  console.log(`[ui-fallback]   Field cleared: ${cleared}`);
  await debugShot(page, `${screenshotPrefix}_01_after_clear`);
  
  if (!cleared) {
    console.warn(`[ui-fallback]   ⚠ Field not fully cleared, but continuing...`);
  }

  // Re-focus and type
  await input.click({ force: true });
  await page.waitForTimeout(200);
  await page.keyboard.type(cityQuery, { delay: 100 });
  await page.waitForTimeout(1500);
  console.log(`[ui-fallback]   Typed "${cityQuery}"`);
  await debugShot(page, `${screenshotPrefix}_02_typed`);

  // Log visible options for debugging
  const options = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('li[role="option"], li'));
    return opts
      .map(opt => {
        const rect = (opt as HTMLElement).getBoundingClientRect();
        return {
          visible: rect.width > 0 && rect.height > 0,
          text: opt.textContent?.trim().substring(0, 70),
        };
      })
      .filter(o => o.visible)
      .slice(0, 8);
  });

  console.log(`[ui-fallback]   Found ${options.length} visible options:`, options.map(o => o.text));

  // Click first visible option (proven approach from prototype)
  await page.evaluate(() => {
    const allOptions = Array.from(document.querySelectorAll('li[role="option"], li'));
    for (const opt of allOptions) {
      const rect = (opt as HTMLElement).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        (opt as HTMLElement).click();
        return;
      }
    }
  });

  await page.waitForTimeout(900);
  console.log(`[ui-fallback] ✓ Clicked first visible dropdown option`);
  await debugShot(page, `${screenshotPrefix}_03_after_select`);

  return true;
}

// ── Step 5: Set trip dates (departure + optional return) ──

async function setTripDates(page: Page, departureIsoDate: string, returnIsoDate?: string): Promise<boolean> {
  const [departureYear, departureMonth, departureDay] = departureIsoDate.split("-").map(Number);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthNamesShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  
  const departureMonthName = monthNames[departureMonth - 1];
  const departureMonthShort = monthNamesShort[departureMonth - 1];
  const departureDayText = departureDay.toString();

  let returnYear = 0;
  let returnMonth = 0;
  let returnDay = 0;
  let returnMonthName = "";
  let returnMonthShort = "";
  let returnDayText = "";
  if (returnIsoDate) {
    [returnYear, returnMonth, returnDay] = returnIsoDate.split("-").map(Number);
    returnMonthName = monthNames[returnMonth - 1];
    returnMonthShort = monthNamesShort[returnMonth - 1];
    returnDayText = returnDay.toString();
  }
  
  console.log(
    `[ui-fallback] setTripDates: departure=${departureIsoDate}${returnIsoDate ? `, return=${returnIsoDate}` : ""}`
  );

  // Click departure date field to open calendar
  const dateFieldSelectors = [
    'input[placeholder*="Departure"]',
    '[aria-label*="Departure"]',
    'button:has-text("Departure")',
  ];
  
  let opened = false;
  for (const sel of dateFieldSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click({ force: true });
      await page.waitForTimeout(1000);
      console.log(`[ui-fallback]   Clicked date field via "${sel}"`);
      opened = true;
      break;
    }
  }
  
  if (!opened) {
    console.warn("[ui-fallback] ⚠ Could not open date picker");
    await debugShot(page, "05_date_FAIL_no_picker");
    return false;
  }
  
  await debugShot(page, "05_date_picker_open");

  // Check if departure month is visible
  const monthVisible = await page.evaluate((targetMonth: string) => {
    const bodyText = document.body.innerText;
    return bodyText.includes(targetMonth);
  }, departureMonthName);
  
  console.log(`[ui-fallback]   Departure month "${departureMonthName}" visible: ${monthVisible}`);

  // Navigate months if needed
  if (!monthVisible) {
    let navAttempts = 0;
    const maxNavAttempts = 6;
    
    while (navAttempts < maxNavAttempts) {
      const isVisible = await page.evaluate((targetMonth: string) => {
        return document.body.innerText.includes(targetMonth);
      }, departureMonthName);
      
      if (isVisible) {
        console.log(`[ui-fallback]   ✓ Departure month "${departureMonthName}" is visible after ${navAttempts} navigation(s)`);
        break;
      }
      
      console.log(`[ui-fallback]   ⏭️  Navigating to next month (attempt ${navAttempts + 1})...`);
      
      const nextButton = page.locator('[aria-label*="Next month"], button[aria-label*="next"]').first();
      if (await nextButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(500);
        navAttempts++;
      } else {
        console.warn(`[ui-fallback]   ⚠️  Could not find next month button`);
        break;
      }
    }
    
    if (navAttempts > 0) {
      await debugShot(page, "05_date_navigated_month");
    }
  }

  // Find and click day cells using aria-label
  // Google Flights uses format: "DayOfWeek, Month Day, Year"
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const clickDateInCalendar = async (monthName: string, dayText: string, year: number): Promise<boolean> => {
    for (const dayOfWeek of daysOfWeek) {
      const ariaLabel = `${dayOfWeek}, ${monthName} ${dayText}, ${year}`;
      const selector = `div[aria-label="${ariaLabel}"], [aria-label="${ariaLabel}"]`;

      const dayCell = page.locator(selector).first();
      if (await dayCell.isVisible({ timeout: 500 }).catch(() => false)) {
        await dayCell.click();
        await page.waitForTimeout(800);
        console.log(`[ui-fallback] ✓ Clicked day cell: "${ariaLabel}"`);
        return true;
      }
    }

    console.warn(`[ui-fallback] ⚠️  Aria-label approach failed for ${monthName} ${dayText}, trying fallback...`);

    const clicked = await page.evaluate((params: { month: string; day: string }) => {
      const { month, day } = params;
      const cells = Array.from(document.querySelectorAll('[role="gridcell"] button, [role="button"], div[aria-label]'));

      for (const cell of cells) {
        const ariaLabel = cell.getAttribute('aria-label') || '';
        const text = cell.textContent?.trim() || '';

        if (ariaLabel.includes(month) && (ariaLabel.includes(day) || text === day)) {
          (cell as HTMLElement).click();
          return { success: true, ariaLabel, text };
        }
      }

      return { success: false, ariaLabel: null, text: null };
    }, { month: monthName, day: dayText });

    if (clicked.success) {
      await page.waitForTimeout(800);
      console.log(`[ui-fallback] ✓ Clicked day cell (fallback): aria-label="${clicked.ariaLabel}"`);
      return true;
    }

    return false;
  };

  const ensureMonthVisible = async (monthName: string): Promise<void> => {
    let navAttempts = 0;
    const maxNavAttempts = 12;
    while (navAttempts < maxNavAttempts) {
      const isVisible = await page.evaluate((targetMonth: string) => {
        return document.body.innerText.includes(targetMonth);
      }, monthName);

      if (isVisible) return;

      const nextButton = page.locator('[aria-label*="Next month"], button[aria-label*="next"]').first();
      if (await nextButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(500);
        navAttempts++;
        continue;
      }
      break;
    }
  };
  
  console.log(`[ui-fallback]   Searching departure day ${departureDayText}...`);
  const departureClicked = await clickDateInCalendar(departureMonthName, departureDayText, departureYear);
  if (!departureClicked) {
    console.error('[ui-fallback] ✗ Could not find or click departure day cell');
    await debugShot(page, "05_date_FAIL_no_day_cell");
    return false;
  }

  if (returnIsoDate) {
    await ensureMonthVisible(returnMonthName);
    console.log(`[ui-fallback]   Searching return day ${returnDayText}...`);
    const returnClicked = await clickDateInCalendar(returnMonthName, returnDayText, returnYear);
    if (!returnClicked) {
      console.error('[ui-fallback] ✗ Could not find or click return day cell');
      await debugShot(page, "05_return_FAIL_no_day_cell");
      return false;
    }
  }
  
  await debugShot(page, "05_date_day_clicked");
  
  // Wait for calendar to close and verify
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");  // Ensure calendar closes
  await page.waitForTimeout(500);
  
  await debugShot(page, "05_date_committed");
  
  // Verify date is visible
  const verification = await page.evaluate((params: {
    depShortMonth: string;
    depFullMonth: string;
    depDay: string;
    depYear: number;
    retShortMonth?: string;
    retFullMonth?: string;
    retDay?: string;
    retYear?: number;
  }) => {
    const {
      depShortMonth,
      depFullMonth,
      depDay,
      depYear,
      retShortMonth,
      retFullMonth,
      retDay,
      retYear,
    } = params;
    const bodyText = document.body.innerText;
    
    const departurePatterns = [
      `${depShortMonth} ${depDay}`,
      `${depFullMonth} ${depDay}`,
      `${depShortMonth} ${depDay}, ${depYear}`,
    ];
    const returnPatterns = retShortMonth && retFullMonth && retDay && retYear
      ? [
          `${retShortMonth} ${retDay}`,
          `${retFullMonth} ${retDay}`,
          `${retShortMonth} ${retDay}, ${retYear}`,
        ]
      : [];
    
    let departureVisible = false;
    for (const pattern of departurePatterns) {
      if (bodyText.includes(pattern)) {
        departureVisible = true;
        break;
      }
    }

    let returnVisible = returnPatterns.length === 0;
    for (const pattern of returnPatterns) {
      if (bodyText.includes(pattern)) {
        returnVisible = true;
        break;
      }
    }
    
    const departureInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder*="Departure"], [aria-label*="Departure"]'));
    const departureFieldValue = departureInputs.length > 0 ? departureInputs[0].value : '';
    
    return {
      departureVisible,
      returnVisible,
      departureFieldValue,
    };
  }, {
    depShortMonth: departureMonthShort,
    depFullMonth: departureMonthName,
    depDay: departureDayText,
    depYear: departureYear,
    retShortMonth: returnIsoDate ? returnMonthShort : undefined,
    retFullMonth: returnIsoDate ? returnMonthName : undefined,
    retDay: returnIsoDate ? returnDayText : undefined,
    retYear: returnIsoDate ? returnYear : undefined,
  });
  
  console.log(
    `[ui-fallback]   Date verification: departureVisible=${verification.departureVisible}, returnVisible=${verification.returnVisible}, field="${verification.departureFieldValue}"`
  );
  
  const departureCommitted = verification.departureVisible ||
    verification.departureFieldValue.includes(departureDayText) ||
    verification.departureFieldValue.includes(departureMonthShort);
  const returnCommitted = !returnIsoDate || verification.returnVisible;

  const success = departureCommitted && returnCommitted;
  
  if (success) {
    console.log(
      `[ui-fallback] ✓ Trip dates committed: departure=${departureMonthShort} ${departureDayText}${returnIsoDate ? `, return=${returnMonthShort} ${returnDayText}` : ""}`
    );
    return true;
  } else {
    console.warn(`[ui-fallback] ⚠ Date confirmation uncertain`);
    return true; // non-blocking
  }
}

// ── Step 6: Submit search ─────────────────────────────────

async function submitSearch(page: Page): Promise<void> {
  console.log("[ui-fallback] submitSearch — looking for Search button...");
  await logDomState(page, "before_search");
  await debugShot(page, "06_before_search");

  const searchSels = [
    'button[aria-label="Search"]',
    'button[jsname="vLv7Lb"]',
    'button.MXvFbd',
  ];
  for (const sel of searchSels) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Check if disabled
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) {
        console.warn(`[ui-fallback] ⚠ Search button found but disabled via "${sel}"`);
        continue;
      }
      await btn.click({ force: true });
      console.log(`[ui-fallback] ✓ Search button clicked via "${sel}"`);
      return;
    }
  }
  // Fallback: press Enter on the active element
  await page.keyboard.press("Enter");
  console.log("[ui-fallback] ✓ Search triggered via Enter (button not found/disabled)");
}

// ── Main form-fill orchestrator ───────────────────────────

async function fillFlightsForm(
  page: Page,
  originCity: string,
  destCity: string,
  date: string,
  returnDate: string | undefined,
  roundTrip: boolean,
): Promise<boolean> {
  // 1. Load base page
  console.log("[ui-fallback] Loading Google Flights base page...");
  await page.goto("https://www.google.com/travel/flights?hl=en", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2500);
  console.log("[ui-fallback] Base URL:", page.url());
  await debugShot(page, "00_page_loaded");
  await logDomState(page, "page_loaded");

  // 2. Dismiss consent
  await dismissConsent(page);

  // 3. Set one-way
  if (!roundTrip) {
    await setOneWay(page);
  }
  await logDomState(page, "after_trip_type");

  // 4. Origin
  const originOk = await setLocationField(page, "origin", originCity, "03_origin");
  if (!originOk) {
    console.error("[ui-fallback] ✗ STEP FAILED: origin — aborting");
    return false;
  }
  await page.waitForTimeout(500);

  // 5. Destination
  const destOk = await setLocationField(page, "destination", destCity, "04_dest");
  if (!destOk) {
    console.error("[ui-fallback] ✗ STEP FAILED: destination — aborting");
    return false;
  }
  await page.waitForTimeout(500);

  // 6. Trip dates (departure + optional return)
  await setTripDates(page, date, returnDate);
  await page.waitForTimeout(500);

  // 7. Submit search
  await submitSearch(page);

  // 8. Wait for SPA navigation + results page to load
  console.log("[ui-fallback] Waiting for navigation to results page...");
  
  // Wait for URL to include results indicators or for result elements to appear
  let resultsReached = false;
  const startTime = Date.now();
  const maxWaitTime = 20000; // 20 seconds
  
  while (!resultsReached && (Date.now() - startTime < maxWaitTime)) {
    await page.waitForTimeout(1500);
    const currentUrl = page.url();
    console.log("[ui-fallback]   Current URL:", currentUrl.substring(0, 100));
    
    // Check if we've reached results page
    if (RESULTS_URL_PATTERN.test(currentUrl)) {
      console.log("[ui-fallback] ✓ Results page reached (URL pattern matched)");
      resultsReached = true;
      break;
    }
    
    // Check for result elements
    const hasResults = await page.evaluate(() => {
      const cards = document.querySelectorAll('li[role="listitem"]');
      let flightCardCount = 0;
      cards.forEach(card => {
        const text = (card as HTMLElement).innerText || '';
        if (/\$\d+/.test(text) && /[AP]M/.test(text)) {
          flightCardCount++;
        }
      });
      return flightCardCount > 0;
    });
    
    if (hasResults) {
      console.log("[ui-fallback] ✓ Results page reached (flight cards detected)");
      resultsReached = true;
      break;
    }
  }
  
  const finalUrl = page.url();
  console.log("[ui-fallback] Final URL:", finalUrl);
  await debugShot(page, "07_results_page");
  await logDomState(page, "results_page");

  const onResults = await isResultsPage(page);
  console.log("[ui-fallback] resultsPageReached=", onResults);
  return onResults;
}



// ── Signals that indicate we are on a results page ───────

// URL pattern: Google Flights results URLs contain "tfs=" (search params)
// or explicit airport codes like "NYC%2EDTW" in the hash fragment.
const RESULTS_URL_PATTERN = /#flt=|flights\/search/i;

// DOM signals that ONLY appear on results pages (not on home/explore page).
// Removed ambiguous signals like [aria-label*="Nonstop"] which appear on
// the home page's popular-flights showcase.
const RESULTS_PAGE_SIGNALS = [
  "li[data-result-index]",           // Old Google Flights result items
  '[jsname="IWWDBc"]',                // Results container jsname
  ".gws-flights-results__result-item", // Result card class
  // Removed: 'div[class*="YMlIz"]'   — also on home page
  // Removed: 'span[aria-label*="Departure time"]' — also on home page
  // Removed: 'div[class*="wtDjF"]'   — also on home page
];

// ── Main entry point ─────────────────────────────────────

export async function searchFlights(
  args: SearchFlightsArgs
): Promise<SearchFlightsResult> {
  console.log("[searchFlights] Starting search:", JSON.stringify(args));

  const originRes = resolveAirportCode(args.origin);
  if (!originRes.resolved) {
    return {
      success: false,
      searchUrl: null,
      error: originRes.error,
      resolutionFailure: { field: "origin", input: originRes.input, suggestions: originRes.suggestions },
    };
  }

  const destRes = resolveAirportCode(args.destination);
  if (!destRes.resolved) {
    return {
      success: false,
      searchUrl: null,
      error: destRes.error,
      resolutionFailure: { field: "destination", input: destRes.input, suggestions: destRes.suggestions },
    };
  }

  const originCode = originRes.code;
  const destCode   = destRes.code;
  const date       = args.date || getDefaultDate();

  // Build the legacy deep-link URL (kept for logging even if it fails)
  let flightParam = `${originCode}.${destCode}.${date}`;
  if (args.returnDate) flightParam += `*${destCode}.${originCode}.${args.returnDate}`;
  const deepLinkUrl = `https://www.google.com/travel/flights?hl=en&curr=USD#flt=${flightParam};c:USD;e:1;sd:1;t:f`;
  console.log("[searchFlights] Deep-link URL:", deepLinkUrl);

  let page: Page;
  try {
    page = await getSessionPage("flights");
    
    // Verify page is not closed
    if (page.isClosed()) {
      console.warn("[searchFlights] Page was already closed, creating new session");
      await resetSession("flights");
      page = await getSessionPage("flights");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[searchFlights] Browser launch failed:", msg);
    return { success: false, searchUrl: deepLinkUrl, error: `Browser launch failed: ${msg}` };
  }

  try {
    // ── Attempt 1: deep-link ─────────────────────────────────────────
    console.log("[searchFlights] strategy=deep-link — navigating...");
    await page.goto(deepLinkUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const urlAfterDeepLink = page.url();
    console.log("[searchFlights] finalUrl after deep-link:", urlAfterDeepLink);

    const deepLinkWorked = await isResultsPage(page);
    console.log("[searchFlights] resultsPageReached=", deepLinkWorked, "(strategy=deep-link)");

    let strategy: "deep-link" | "ui-fallback" = "deep-link";

    if (!deepLinkWorked) {
      // ── Attempt 2: UI form-fill ──────────────────────────────────
      console.log("[searchFlights] strategy=ui-fallback — deep-link landed on explore page");
      strategy = "ui-fallback";

      const formOk = await fillFlightsForm(
        page,
        args.origin,  // Use original user input (e.g., "New York" without airport code)
        args.destination,  // Use original user input (e.g., "Detroit" without airport code)
        date,
        args.returnDate,
        !!args.returnDate,
      );

      if (!formOk) {
        console.log("[searchFlights] finalUrl after failed form-fill:", page.url());
        markSessionIdle("flights");
        return {
          success: false,
          searchUrl: deepLinkUrl,
          navigationStrategy: strategy,
          error: "UI form-fill did not reach results page.",
          pageState: "preserved",
        };
      }
    }

    console.log("[searchFlights] strategy=", strategy, "— waiting for flight cards...");
    const resultsReady = await waitForResults(page);
    console.log("[searchFlights] resultsPageReached=", resultsReady, "(final)");

    if (!resultsReady) {
      const len = (await page.content()).length;
      console.log("[searchFlights] Page content length:", len, "— no cards found");
      markSessionIdle("flights");
      return {
        success: false,
        searchUrl: deepLinkUrl,
        navigationStrategy: strategy,
        error: "Flight result cards did not appear. Layout may have changed.",
        pageState: "preserved",
      };
    }

    let verification = await getResultsPageVerification(page);
    console.log("[searchFlights] final URL after search:", verification.finalUrl);
    console.log("[searchFlights] results page reached:", verification.resultsPageReached);
    console.log("[searchFlights] results-page selector matched:", verification.selectorMatched ?? "(none)");
    console.log("[searchFlights] number of visible flight cards found:", verification.visibleFlightCards);

    let extraction = await extractFlightResults(page);
    console.log("[searchFlights] number of extracted flights:", extraction.flights.length);
    if (extraction.warnings.length > 0) {
      console.warn("[searchFlights] extraction warnings:", extraction.warnings);
    }

    if (strategy === "deep-link" && extraction.flights.length === 0) {
      console.warn("[searchFlights] deep-link returned no flights; retrying with UI fallback");
      const fallbackOk = await fillFlightsForm(
        page,
        args.origin,
        args.destination,
        date,
        args.returnDate,
        !!args.returnDate,
      );

      if (fallbackOk) {
        strategy = "ui-fallback";
        const fallbackReady = await waitForResults(page);
        console.log("[searchFlights] ui-fallback retry resultsPageReached=", fallbackReady);
        verification = await getResultsPageVerification(page);
        console.log("[searchFlights] final URL after ui-fallback retry:", verification.finalUrl);
        console.log("[searchFlights] results-page selector matched after retry:", verification.selectorMatched ?? "(none)");
        console.log("[searchFlights] number of visible flight cards found after retry:", verification.visibleFlightCards);

        extraction = await extractFlightResults(page);
        console.log("[searchFlights] number of extracted flights after retry:", extraction.flights.length);
        if (extraction.warnings.length > 0) {
          console.warn("[searchFlights] extraction warnings after retry:", extraction.warnings);
        }
      }
    }
    markSessionIdle("flights");

    return {
      success: true,
      searchUrl: deepLinkUrl,
      navigationStrategy: strategy,
      searchParams: {
        origin: args.origin,
        destination: args.destination,
        date,
        returnDate: args.returnDate,
      },
      flights: extraction.flights,
      warnings: extraction.warnings,
      extractionWarnings: extraction.warnings.length > 0 ? extraction.warnings : undefined,
      resultsPageVerification: verification,
      pageState: "preserved",
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[searchFlights] Unexpected error:", msg);
    markSessionIdle("flights");
    return { success: false, searchUrl: deepLinkUrl, error: msg, pageState: "preserved" };
  }
}

// ── Navigation helpers ───────────────────────────────────

async function isResultsPage(page: Page): Promise<boolean> {
  // ── Strategy 1: URL pattern (most reliable) ──────────────────────────
  const url = page.url();
  if (RESULTS_URL_PATTERN.test(url)) {
    console.log(`[searchFlights] Results-page signal: URL matched pattern — ${url.substring(0, 100)}`);
    return true;
  }

  // ── Strategy 2: DOM signals ──────────────────────────────────────────
  for (const sel of RESULTS_PAGE_SIGNALS) {
    try {
      const el = await page.$(sel);
      if (el) {
        console.log(`[searchFlights] Results-page signal matched: "${sel}"`);
        return true;
      }
    } catch { continue; }
  }

  // ── Strategy 3: body-text heuristic with strict time-pattern check ───
  // Require departure *time* patterns ("7:30 AM") — these ONLY appear on
  // the results page, not on the home/explore page which has generic
  // "Nonstop" and "$161" text from popular-flights showcases.
  try {
    const bodyText = await page.evaluate(`document.body.innerText`) as string;
    const hasPrices    = /\$\d+/.test(bodyText);
    const hasTimestamp = /\d{1,2}:\d{2}\s*[AP]M/i.test(bodyText);  // e.g. "7:30 AM"
    const hasStops     = /nonstop|\d+\s*stop/i.test(bodyText);
    if (hasPrices && hasTimestamp && hasStops) {
      console.log(`[searchFlights] Results-page signal: body has prices + times + stops`);
      return true;
    }
  } catch { /* ignore */ }

  return false;
}

async function waitForResults(page: Page): Promise<boolean> {
  // ── Strategy 1: already on results (URL check) ───────────────────────
  if (RESULTS_URL_PATTERN.test(page.url())) {
    console.log(`[searchFlights] waitForResults: URL already indicates results page`);
    return true;
  }

  // ── Strategy 2: wait up to 15 s for URL to change ────────────────────
  try {
    await page.waitForFunction(
      `(function() {
        var href = location.href || '';
        if (/\/travel\/explore/i.test(href)) return false;
        return /#flt=|\/flights\/search/i.test(href);
      })()`,
      { timeout: 15000 },
    );
    console.log(`[searchFlights] waitForResults: URL changed to results pattern`);
    return true;
  } catch { /* no URL change — try DOM */ }

  // ── Strategy 3: wait for result-specific DOM elements ─────────────────
  // Wait for selectors that uniquely identify results (not home page).
  const uniqueResultSels = [
    'li[data-result-index]',               // Old result items
    '[jsname="IWWDBc"]',                  // Results container
    '.gws-flights-results__result-item',  // Result card
  ];
  for (const sel of uniqueResultSels) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      console.log(`[searchFlights] waitForResults: result element appeared: "${sel}"`);
      return true;
    } catch { /* try next */ }
  }

  // ── Strategy 4: body-text with strict time-pattern check ─────────────
  try {
    const bodyText = await page.evaluate(`document.body.innerText`) as string;
    const hasPrices    = /\$\d+/.test(bodyText);
    const hasTimestamp = /\d{1,2}:\d{2}\s*[AP]M/i.test(bodyText);
    const hasStops     = /nonstop|\d+\s*stop/i.test(bodyText);
    if (hasPrices && hasTimestamp && hasStops) {
      console.log(`[searchFlights] waitForResults: body-text confirms flight results (prices+times+stops)`);
      return true;
    }
  } catch { /* ignore */ }

  return false;
}

// ── Extraction ───────────────────────────────────────────

interface ExtractionResult { flights: FlightResult[]; warnings: string[]; }

async function extractFlightResults(page: Page): Promise<ExtractionResult> {
  const selectorProbe = await page.evaluate(`(function() {
    var roleItems = Array.from(document.querySelectorAll('[role="listitem"]')).filter(function(el){
      var txt = el.innerText || '';
      return /\\$\\d+/.test(txt) && /[AP]M/.test(txt);
    }).length;
    var liItems = Array.from(document.querySelectorAll('li')).filter(function(el){
      var txt = el.innerText || '';
      return /\\$\\d+/.test(txt) && /[AP]M/.test(txt) && txt.length > 30;
    }).length;
    return { roleItems: roleItems, liItems: liItems };
  })()`).catch(() => ({ roleItems: 0, liItems: 0 })) as { roleItems: number; liItems: number };
  const selectorUsed = selectorProbe.roleItems > 0
    ? '[role="listitem"]'
    : selectorProbe.liItems > 0
      ? 'li'
      : '(none)';
  console.log("[searchFlights] selector used for flight cards:", selectorUsed);

  // Use stringified evaluate to avoid esbuild __name injection issues
  const raw = await page.evaluate(`(function extractFlights() {
    var warnings = [];
    var flights = [];

    // ── Attempt A: aria-label structured extraction ────────────────────
    // Google wraps each flight card in a [role="listitem"] with a rich
    // aria-label that contains all the info we need.
    var items = Array.from(document.querySelectorAll('[role="listitem"]'));
    // Filter to plausible flight cards: must contain a price pattern
    var cards = items.filter(function(el) {
      var txt = el.innerText || '';
      return /\\$\\d+/.test(txt) && /[AP]M/.test(txt);
    });

    if (cards.length === 0) {
      // Broader fallback — any li with a price
      cards = Array.from(document.querySelectorAll('li')).filter(function(el) {
        var txt = el.innerText || '';
        return /\\$\\d+/.test(txt) && /[AP]M/.test(txt) && txt.length > 30;
      });
    }

    if (cards.length > 0) {
      cards.slice(0, 6).forEach(function(card) {
        var txt = card.innerText || '';
        var lines = txt.split('\\n').map(function(l){ return l.trim(); }).filter(Boolean);

        // Price: line matching $NNN
        var priceMatch = txt.match(/\\$(\\d[\\d,]+)/);
        var price = priceMatch ? ('$' + priceMatch[1]) : '';

        // Times: HH:MM AM/PM patterns
        var times = txt.match(/\\d{1,2}:\\d{2}\\s*[AP]M/gi) || [];
        var dep = times[0] || '';
        var arr = times[1] || '';

        // Duration: Xh XXm or X hr XX min
        var durMatch = txt.match(/(\\d+\\s*hr\\s*\\d*\\s*min|\\d+h\\s+\\d+m)/i);
        var duration = durMatch ? durMatch[0].trim() : '';

        // Stops: nonstop, 1 stop, 2 stops
        var stopsMatch = txt.match(/nonstop|\\d+\\s*stop/i);
        var stops = stopsMatch ? stopsMatch[0] : '';

        // Airline: try aria-label first, then text heuristics
        var ariaLabel = card.getAttribute('aria-label') || '';
        var airlineMatch = ariaLabel.match(/^([^.]+?)\\.\\s/) ||
                           ariaLabel.match(/on ([A-Z][a-zA-Z\\s]+)\\./) ||
                           txt.match(/^([A-Z][a-z]+(?:\\s[A-Z][a-z]+)*)/m);
        var airline = airlineMatch ? airlineMatch[1].trim() : 'Unknown Airline';
        // Avoid picking up generic words
        if (/price|flight|nonstop|stop|depart|arri/i.test(airline)) airline = 'Unknown Airline';

        if (!dep && !price) {
          warnings.push('Skipped card: missing departure time and price');
          return;
        }
        flights.push({ airline: airline, departure: dep, arrival: arr,
                       duration: duration, stops: stops,
                       price: price || 'Price unavailable' });
      });
    } else {
      warnings.push('No flight cards found via DOM card selectors');
    }

    // ── Attempt B: body-text line parsing (fallback) ───────────────────
    if (flights.length === 0) {
      warnings.push('Falling back to body-text extraction');
      var bodyLines = (document.body.innerText || '').split('\\n')
                        .map(function(l){ return l.trim(); }).filter(Boolean);
      var priceLines = bodyLines.filter(function(l) { return /^\\$\\d/.test(l); });
      priceLines.slice(0, 5).forEach(function(priceLine, idx) {
        // Look at surrounding lines for context
        var priceIdx = bodyLines.indexOf(priceLine);
        var context = bodyLines.slice(Math.max(0, priceIdx - 8), priceIdx + 3).join(' ');
        var times = context.match(/\\d{1,2}:\\d{2}\\s*[AP]M/gi) || [];
        var durMatch = context.match(/(\\d+\\s*hr\\s*\\d*\\s*min|\\d+h\\s+\\d+m)/i);
        var stopsMatch = context.match(/nonstop|\\d+\\s*stop/i);
        flights.push({
          airline: 'Unknown Airline',
          departure: times[0] || '',
          arrival: times[1] || '',
          duration: durMatch ? durMatch[0] : '',
          stops: stopsMatch ? stopsMatch[0] : '',
          price: priceLine
        });
      });
    }

    if (flights.length > 0 && flights.some(function(f){ return !f.departure || !f.price; })) {
      warnings.push('Some flights have incomplete data');
    }
    return { flights: flights, warnings: warnings };
  })()`).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return { flights: [] as FlightResult[], warnings: [`Extraction threw: ${msg}`] };
  }) as ExtractionResult;

  console.log("[searchFlights] Extraction complete:", {
    flightCount: raw.flights.length,
    warnings: raw.warnings,
  });
  return raw;
}
