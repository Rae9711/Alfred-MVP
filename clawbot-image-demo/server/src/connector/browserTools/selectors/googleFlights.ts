/**
 * Google Flights DOM Selectors
 * 
 * Centralized selector definitions for Google Flights extraction.
 * 
 * MAINTENANCE NOTES:
 * - Google Flights updates its DOM frequently
 * - Test selectors monthly or after extraction failures
 * - Each selector group has fallbacks in priority order
 * - Log which selector succeeded for debugging
 * 
 * Last verified: 2026-03-12
 */

// ── Types ────────────────────────────────────────────────

export interface SelectorGroup {
  /** Selectors to try in order (first match wins) */
  selectors: string[];
  /** Attribute to extract (default: textContent) */
  attribute?: "textContent" | "innerText" | "innerHTML" | string;
  /** Whether this field is required for a valid result */
  required?: boolean;
  /** Default value if extraction fails */
  defaultValue?: string;
  /** Description for debugging */
  description?: string;
}

// ── Google Flights Selectors ─────────────────────────────

export const GOOGLE_FLIGHTS_SELECTORS = {
  /**
   * Results container — where flight cards live
   */
  resultsContainer: {
    selectors: [
      "li[data-result-index]",
      '[jsname="IWWDBc"]',
      ".gws-flights-results__result-item",
      '[role="listitem"][data-ved]',
      'ul[class*="flight"] > li',
    ],
    description: "Individual flight result cards",
  } as SelectorGroup,

  /**
   * Fields within each flight card
   */
  flightCard: {
    airline: {
      selectors: [
        '[data-airline-name]',
        'span[class*="sSHqwe"]',
        '.gws-flights__ellipsize',
        '[class*="airline"] span',
        'div[class*="carrier"] span',
        'span[class*="Ir0Voe"]',
      ],
      attribute: "textContent",
      required: false,
      defaultValue: "Unknown Airline",
      description: "Airline name (e.g., Delta, United)",
    } as SelectorGroup,

    departureTime: {
      selectors: [
        'span[aria-label*="Departure time"]',
        'span[aria-label*="Depart"]',
        '[aria-label*="departure"] span',
        'div[class*="wtDjF"] span:first-child',
        'span[class*="mv1WYe"]:first-child',
        '.gws-flights-results__times span:first-child',
      ],
      attribute: "textContent",
      required: true,
      description: "Departure time (e.g., 8:00 AM)",
    } as SelectorGroup,

    arrivalTime: {
      selectors: [
        'span[aria-label*="Arrival time"]',
        'span[aria-label*="Arrive"]',
        '[aria-label*="arrival"] span',
        'div[class*="wtDjF"] span:last-child',
        'span[class*="mv1WYe"]:last-child',
        '.gws-flights-results__times span:last-child',
      ],
      attribute: "textContent",
      required: true,
      description: "Arrival time (e.g., 11:30 AM)",
    } as SelectorGroup,

    duration: {
      selectors: [
        '[aria-label*="duration"]',
        '[aria-label*="Total duration"]',
        'div[class*="gvkrdb"]',
        '.gws-flights-results__duration',
        'div[class*="Ak5kof"]',
      ],
      attribute: "textContent",
      required: false,
      defaultValue: "",
      description: "Flight duration (e.g., 2 hr 30 min)",
    } as SelectorGroup,

    stops: {
      selectors: [
        '[aria-label*="stop"]',
        '[aria-label*="Nonstop"]',
        'span[class*="EfT7Ae"]',
        '.gws-flights-results__stops',
        'span[class*="stops"]',
        'div[class*="BbR8Ec"]',
      ],
      attribute: "textContent",
      required: false,
      defaultValue: "Unknown",
      description: "Number of stops (e.g., Nonstop, 1 stop)",
    } as SelectorGroup,

    price: {
      selectors: [
        'span[aria-label*="price"]',
        'span[data-gs]',
        'div[class*="YMlIz"] span',
        'span[class*="price"]',
        'div[class*="BVAVmf"] span',
        'span[class*="FpEdX"]',
      ],
      attribute: "textContent",
      required: true,
      description: "Price (e.g., $189)",
    } as SelectorGroup,
  },

  /**
   * No results / error states
   */
  noResults: {
    selectors: [
      'text="No flights found"',
      'text="找不到航班"',
      '[class*="no-results"]',
      'text="No matching flights"',
    ],
    description: "Indicates no flights matched the search",
  } as SelectorGroup,

  /**
   * Loading states
   */
  loading: {
    selectors: [
      '[aria-busy="true"]',
      'div[class*="loading"]',
      '[class*="spinner"]',
    ],
    description: "Page is still loading results",
  } as SelectorGroup,
};

// ── Selector Utilities ───────────────────────────────────

/**
 * Try multiple selectors in order, return the first successful match.
 * 
 * @param element - Parent element to search within
 * @param group - Selector group with fallbacks
 * @returns Extraction result with value and debug info
 */
export function trySelectorsSync(
  element: Element,
  group: SelectorGroup
): { value: string | null; usedSelector: string | null; warning?: string } {
  for (const selector of group.selectors) {
    try {
      const el = element.querySelector(selector);
      if (el) {
        let value: string | null = null;
        
        if (group.attribute === "textContent" || !group.attribute) {
          value = el.textContent?.trim() || null;
        } else if (group.attribute === "innerText") {
          value = (el as HTMLElement).innerText?.trim() || null;
        } else if (group.attribute === "innerHTML") {
          value = el.innerHTML?.trim() || null;
        } else {
          value = el.getAttribute(group.attribute) || null;
        }
        
        if (value) {
          return { value, usedSelector: selector };
        }
      }
    } catch {
      // Continue to next selector
    }
  }
  
  return {
    value: group.defaultValue || null,
    usedSelector: null,
    warning: group.required
      ? `Required field not found (tried ${group.selectors.length} selectors): ${group.description}`
      : undefined,
  };
}

/**
 * Log selector debug information.
 */
export function logSelectorUsage(
  field: string,
  result: { usedSelector: string | null; warning?: string }
): void {
  if (result.usedSelector) {
    console.log(`[selectors] ${field}: matched "${result.usedSelector}"`);
  } else if (result.warning) {
    console.warn(`[selectors] ${field}: ${result.warning}`);
  }
}
