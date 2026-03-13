/**
 * Browser Tools Dispatcher
 * 
 * Routes browser tool invocations to their implementations.
 * All browser tools run in the connector (user's machine) via Playwright.
 */

import { searchFlights } from "./tasks/searchFlights.js";
import { openPage } from "./tasks/openPage.js";
import { searchWeb } from "./tasks/searchWeb.js";
import { extractPage } from "./tasks/extractPage.js";
import { clickLinkByText } from "./tasks/clickLinkByText.js";
import { fillInputTool } from './tasks/fillInput.js';
import { composeGmailDraft } from './tasks/composeGmailDraft.js';
import { resumeGmailAfterLogin } from './tasks/resumeGmailAfterLogin.js';
import { chatgptPrompt } from './tasks/chatgptPrompt.js';
import { readGmail } from './tasks/readGmail.js';
import { manageCalendar } from './tasks/manageCalendar.js';

const BROWSER_TOOLS = new Set([
  "browser.search_flights",
  "browser.open_page",
  "browser.search_web",
  "browser.extract_page",
  "browser.click_link_by_text",
  "browser.fill_input",
  "browser.compose_gmail_draft",
  "browser.read_gmail",
  "browser.manage_calendar",
  "browser.resume_gmail_after_login",
  "browser.submit_chatgpt_prompt",
]);

/**
 * Check if a tool ID is a browser tool that should be handled by this module.
 */
export function isBrowserTool(toolId: string): boolean {
  return BROWSER_TOOLS.has(toolId);
}

/**
 * Execute a browser tool with the given arguments.
 * 
 * @param toolId - The tool ID (e.g., "browser.search_flights")
 * @param args - Tool-specific arguments
 * @returns Tool result (success/failure with data)
 */
export async function executeBrowserTool(
  toolId: string,
  args: Record<string, any>
): Promise<any> {
  console.log(`[browserTools] Executing: ${toolId}`, JSON.stringify(args).substring(0, 200));
  
  const startTime = Date.now();
  
  try {
    let result: any;
    
    switch (toolId) {
      case "browser.search_flights":
        result = await searchFlights(args as any);
        break;

      case "browser.open_page":
        result = await openPage(args as any);
        break;

      case "browser.search_web":
        result = await searchWeb(args as any);
        break;

      case "browser.extract_page":
        result = await extractPage(args as any);
        break;

      case "browser.click_link_by_text":
        result = await clickLinkByText(args as any);
        break;

      case "browser.fill_input":
        result = await fillInputTool(args as any);
        break;

      case "browser.compose_gmail_draft":
        result = await composeGmailDraft(args as any);
        break;

      case "browser.resume_gmail_after_login":
        result = await resumeGmailAfterLogin(args as any);
        break;

      case "browser.submit_chatgpt_prompt":
        result = await chatgptPrompt(args as any);
        break;

      case "browser.read_gmail":
        result = await readGmail(args as any);
        break;

      case "browser.manage_calendar":
        result = await manageCalendar(args as any);
        break;

      default:
        throw new Error(`Unknown browser tool: ${toolId}`);
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[browserTools] ${toolId} completed in ${elapsed}ms`);
    
    return result;
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[browserTools] ${toolId} failed after ${elapsed}ms:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}
