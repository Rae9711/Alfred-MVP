/**
 * Google Flights UI Interaction Prototype
 * 
 * Purpose: Prove that we can reliably interact with Google Flights form fields
 * and verify committed selections.
 * 
 * This prototype does NOT attempt extraction or full search flow.
 * It ONLY tests:
 * 1. Open Google Flights
 * 2. Switch to one-way
 * 3. Select origin + verify committed
 * 4. Select destination + verify committed
 * 5. Select departure date + verify committed
 * 
 * Success criteria: All fields show committed values in the UI.
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, 'debug-screenshots-prototype');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function screenshot(page: Page, name: string) {
  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  const size = fs.statSync(filepath).size;
  console.log(`📸 ${name}.png (${Math.round(size / 1024)}KB)`);
}

async function debugDOM(page: Page, name: string): Promise<void> {
  // Save detailed DOM snapshot for debugging
  const debugPath = path.join(SCREENSHOT_DIR, `dom-${name}.html`);
  const debugInfo = await page.evaluate(() => {
    return {
      url: window.location.href,
      activeElement: {
        tag: document.activeElement?.tagName,
        ariaLabel: document.activeElement?.getAttribute('aria-label'),
      },
      listboxes: Array.from(document.querySelectorAll('[role="listbox"]')).map(lb => ({
        visible: (lb as HTMLElement).offsetParent !== null,
        optionCount: lb.querySelectorAll('[role="option"]').length,
        innerHTML: lb.innerHTML.substring(0, 500),
      })),
    };
  });
  
  const htmlContent = await page.content();
  fs.writeFileSync(debugPath, `<!-- Debug Info: ${JSON.stringify(debugInfo, null, 2)} -->\\n${htmlContent}`);
  console.log(`   🔍 DOM debug saved: dom-${name}.html`);
}

async function logFieldState(page: Page, label: string) {
  const state = await page.evaluate(() => {
    const originInput = document.querySelector('input[placeholder*="Where from"]') as HTMLInputElement | null;
    const destInput = document.querySelector('input[placeholder*="Where to"]') as HTMLInputElement | null;
    
    // Try multiple selectors for trip type button
    const roundTripBtn = document.querySelector('[aria-label*="Round trip"]');
    const oneWayBtn = document.querySelector('[aria-label*="One way"]');
    const tripTypeBtn = roundTripBtn || oneWayBtn;
    
    // Also log all buttons for debugging
    const allButtons = Array.from(document.querySelectorAll('button'))
      .slice(0, 10)
      .map(function(b) { return (b.textContent || '').trim().substring(0, 30); });
    
    return {
      originVisible: !!originInput && originInput.offsetParent !== null,
      originValue: originInput?.value || '',
      destinationVisible: !!destInput && destInput.offsetParent !== null,
      destinationValue: destInput?.value || '',
      tripType: tripTypeBtn?.textContent?.trim() || 'unknown',
      allButtonTexts: allButtons,
    };
  });
  console.log(`\n📋 [${label}]`);
  console.log(`   Origin: visible=${state.originVisible}, value="${state.originValue}"`);
  console.log(`   Destination: visible=${state.destinationVisible}, value="${state.destinationValue}"`);
  console.log(`   Trip type: ${state.tripType}`);
  console.log(`   All button texts: ${state.allButtonTexts.join(', ')}`);
  return state;
}

async function setOneWay(page: Page): Promise<boolean> {
  console.log('\n🎯 Setting trip type to one-way...');
  
  // Wait a bit more for page to fully render
  await page.waitForTimeout(1000);
  
  // Try many selectors for the trip type button
  const tripTypeSelectors = [
    'button:has-text("Round trip")',
    '[aria-label*="Round trip"]',
    '[aria-label*="Trip type"]',
    '[jsname]:has-text("Round trip")',
    'div[role="button"]:has-text("Round trip")',
  ];
  
  console.log('   Trying to find trip type button...');
  
  let menuOpened = false;
  for (const sel of tripTypeSelectors) {
    console.log(`   Trying selector: "${sel}"`);
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(700);
      console.log(`   ✓ Clicked trip type button via "${sel}"`);
      menuOpened = true;
      break;
    }
  }
  
  if (!menuOpened) {
    console.log('   ⚠️ Could not find trip type button by selector');
    console.log('   Trying generic button search...');
    
    // Fallback: find any button containing "Round trip"
    const allButtons = await page.locator('button').all();
    for (const btn of allButtons) {
      const text = await btn.textContent().catch(() => '');
      if (text && (text.includes('Round trip') || text.includes('roundtrip'))) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(700);
        console.log(`   ✓ Clicked button with text: "${text.substring(0, 30)}"`);
        menuOpened = true;
        break;
      }
    }
  }
  
  if (!menuOpened) {
    console.log('   ✗ Could not open trip type menu after all attempts');
    return false;
  }
  
  await screenshot(page, '01_trip_menu_open');
  
  // Log what's in the dropdown
  const dropdownContent = await page.evaluate(() => {
    const listbox = document.querySelector('[role="listbox"]');
    const options = Array.from(document.querySelectorAll('li[role="option"], [role="option"]'));
    return {
      hasListbox: !!listbox,
      options: options.map((el, i) => ({
        idx: i,
        text: el.textContent?.trim().substring(0, 40) || '',
        role: el.getAttribute('role'),
      })),
    };
  });
  console.log(`   Dropdown state: hasListbox=${dropdownContent.hasListbox}, options=${dropdownContent.options.length}`);
  dropdownContent.options.forEach(o => console.log(`     [${o.idx}] ${o.text} (role=${o.role})`));
  
  if (dropdownContent.options.length === 0) {
    console.log('   ✗ No options in dropdown');
    return false;
  }
  
  // Find "One way" option by index
  const oneWayIdx = dropdownContent.options.findIndex(o => 
    o.text.includes('One way') || o.text.includes('one way')
  );
  
  if (oneWayIdx === -1) {
    console.log('   ✗ "One way" option not found in dropdown');
    return false;
  }
  
  console.log(`   Found "One way" at index ${oneWayIdx}`);
  
  // Click by index using JavaScript click (bypasses all visibility checks)
  await page.evaluate((idx: number) => {
    const options = document.querySelectorAll('[role="option"]');
    const target = options[idx] as HTMLElement;
    if (target) target.click();
  }, oneWayIdx);
  
  await page.waitForTimeout(700);
  console.log(`   ✓ Clicked "One way" option at index ${oneWayIdx}`);
  
  await screenshot(page, '02_one_way_selected');
  return true;
}

/**
 * Robustly clear a Google Flights location field.
 * Handles both empty inputs and committed chips/tokens.
 */
async function clearField(
  page: Page,
  fieldType: 'origin' | 'destination',
  screenshotPrefix: string,
): Promise<{ success: boolean; input: any; previousValue: string }> {
  console.log(`\n🧹 Clearing ${fieldType} field...`);
  
  const ariaLabel = fieldType === 'origin' ? 'Where from?' : 'Where to?';
  
  // Find the input
  const inputSelectors = [
    `input[aria-label="${ariaLabel}"]`,
    `input[aria-label*="${fieldType === 'origin' ? 'from' : 'to'}"]`,
    `input[placeholder*="${fieldType === 'origin' ? 'from' : 'to'}"]`,
  ];
  
  let input: any = null;
  for (const sel of inputSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      input = el;
      console.log(`   ✓ Found input via "${sel}"`);
      break;
    }
  }
  
  if (!input) {
    console.log(`   ✗ Could not find ${fieldType} input`);
    return { success: false, input: null, previousValue: '' };
  }
  
  // Get previous committed value from body text (chip display)
  const previousState = await page.evaluate((label: string) => {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    const inputValue = input?.value || '';
    const bodyText = document.body.innerText;
    
    // Look for common airport codes (3 uppercase letters)
    const airportMatch = bodyText.match(/\b[A-Z]{3}\b/);
    
    return {
      inputValue,
      inputVisible: input ? input.offsetParent !== null : false,
      bodySnippet: bodyText.substring(0, 300),
      detectedAirport: airportMatch ? airportMatch[0] : null,
    };
  }, ariaLabel);
  
  console.log(`   Previous state:`);
  console.log(`     inputValue: "${previousState.inputValue}"`);
  console.log(`     inputVisible: ${previousState.inputVisible}`);
  console.log(`     detectedAirport: ${previousState.detectedAirport}`);
  
  await screenshot(page, `${screenshotPrefix}_00_before_clear`);
  
  // Strategy 1: Use Playwright's clear() method (most reliable)
  console.log(`   Strategy 1: Using Playwright's clear() method...`);
  try {
    await input.clear();
    await page.waitForTimeout(500);
    
    let currentValue = await input.inputValue().catch(() => '');
    console.log(`   After clear(): value="${currentValue}"`);
    
    if (currentValue.length === 0) {
      console.log(`   ✅ Successfully cleared with clear() method`);
      await screenshot(page, `${screenshotPrefix}_01_after_clear`);
      return {
        success: true,
        input,
        previousValue: previousState.detectedAirport || previousState.inputValue,
      };
    }
  } catch (e) {
    console.log(`   clear() method failed: ${e}`);
  }
  
  // Strategy 2: Triple-click and delete
  // Strategy 2: Triple-click and delete
  console.log(`   Strategy 2: Triple-click to select all and delete...`);
  await input.click({ clickCount: 3, force: true });
  await page.waitForTimeout(500);
  
  // Check selection by trying to get selected text
  const hasSelection = await page.evaluate(() => {
    const sel = window.getSelection();
    return sel ? sel.toString().length > 0 : false;
  });
  
  if (hasSelection) {
    console.log(`   ✅ Text is selected, deleting it first...`);
    // Delete the selection FIRST, then we'll type fresh
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    
    const afterDelete = await input.inputValue().catch(() => '');
    console.log(`   After deleting selection: value="${afterDelete}"`);
    
    if (afterDelete.length === 0) {
      await screenshot(page, `${screenshotPrefix}_01_after_clear`);
      return {
        success: true,
        input,
        previousValue: previousState.detectedAirport || previousState.inputValue,
      };
    }
  }
  
  // Strategy 3: Use fill method
  console.log(`   Strategy 3: Using fill('') method...`);
  await input.fill('');
  await page.waitForTimeout(500);
  
  let currentValue = await input.inputValue().catch(() => '');
  console.log(`   After fill: value="${currentValue}"`);
  
  if (currentValue.length === 0) {
    await screenshot(page, `${screenshotPrefix}_01_after_clear`);
    return {
      success: true,
      input,
      previousValue: previousState.detectedAirport || previousState.inputValue,
    };
  }
  
  // Strategy 4: JavaScript direct manipulation
  console.log(`   Strategy 4: JavaScript direct manipulation...`);
  await page.evaluate((label: string) => {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, ariaLabel);
  await page.waitForTimeout(500);
  currentValue = await input.inputValue().catch(() => '');
  console.log(`   After JavaScript clear: value="${currentValue}"`);
  
  if (currentValue.length === 0) {
    await screenshot(page, `${screenshotPrefix}_01_after_clear`);
    return {
      success: true,
      input,
      previousValue: previousState.detectedAirport || previousState.inputValue,
    };
  }
  
  // Strategy 5: Look for clear button
  console.log(`   Strategy 5: Looking for clear/remove buttons...`);
  
  const clearButtons = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    return buttons.map((btn, idx) => ({
      idx,
      ariaLabel: btn.getAttribute('aria-label') || '',
      text: (btn as HTMLElement).innerText.trim(),
      hasCloseIcon: btn.querySelector('[aria-label*="clear"], [aria-label*="remove"], [aria-label*="Close"]') !== null,
    })).filter(b => 
      b.ariaLabel.toLowerCase().includes('clear') ||
      b.ariaLabel.toLowerCase().includes('remove') ||
      b.ariaLabel.toLowerCase().includes('close') ||
      b.text === '×' || b.text === '✕'
    );
  });
  
  if (clearButtons.length > 0) {
    console.log(`   Found ${clearButtons.length} potential clear buttons`);
    clearButtons.forEach(b => console.log(`     [${b.idx}] "${b.ariaLabel}" text="${b.text}"`));
    
    // Click the first clear button
    const allButtons = await page.locator('button, [role="button"]').all();
    if (clearButtons[0].idx < allButtons.length) {
      await allButtons[clearButtons[0].idx].click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
      console.log(`   Clicked clear button`);
    }
  }
  
  currentValue = await input.inputValue().catch(() => '');
  console.log(`   After strategy 5: value="${currentValue}"`);
  
  
  // Final verification
  const finalState = await page.evaluate((label: string) => {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    return {
      inputValue: input?.value || '',
      isEmpty: !input?.value || input.value.length === 0,
    };
  }, ariaLabel);
  
  await screenshot(page, `${screenshotPrefix}_01_after_clear`);
  
  console.log(`   ✅ Field cleared: isEmpty=${finalState.isEmpty}, value="${finalState.inputValue}"`);
  
  return {
    success: finalState.isEmpty,
    input,
    previousValue: previousState.detectedAirport || previousState.inputValue,
  };
}

async function setLocation(
  page: Page,
  fieldType: 'origin' | 'destination',
  cityName: string,
  screenshotPrefix: string,
): Promise<boolean> {
  console.log(`\n🎯 Setting ${fieldType}: "${cityName}"...`);
  
  const ariaLabel = fieldType === 'origin' ? 'Where from?' : 'Where to?';
  
  // Step 1: Clear the field completely
  const clearResult = await clearField(page, fieldType, screenshotPrefix);
  
  if (!clearResult.success) {
    console.log(`   ✗ Failed to clear ${fieldType} field`);
    await screenshot(page, `${screenshotPrefix}_FAIL_clear`);
    return false;
  }
  
  if (clearResult.previousValue) {
    console.log(`   ℹ️  Previous committed value: "${clearResult.previousValue}"`);
  }
  
  const input = clearResult.input;
  
  // Verify field is truly empty now
  const preTypeValue = await input.inputValue().catch(() => '');
  if (preTypeValue.length > 0) {
    console.log(`   ⚠️  WARNING: Field not empty before typing! value="${preTypeValue}"`);
    await screenshot(page, `${screenshotPrefix}_FAIL_not_empty`);
    return false;
  }
  
  console.log(`   ✅ Field is empty, ready to type`);
  
  // Re-click and focus the field to ensure it's ready for typing
  await input.click({ force: true });
  await page.waitForTimeout(500);
  console.log(`   Re-focused field after clearing`);
  
  // Step 2: Type the city name with realistic delays
  
  await page.keyboard.type(cityName, { delay: 100 });
  console.log(`   ✅ Typed query: "${cityName}"`);
  await page.waitForTimeout(1200);
  
  await screenshot(page, `${screenshotPrefix}_02_typed`);
  
  // Step 3: Wait for dropdown - simple approach
  console.log('   Waiting for dropdown...');
  await page.waitForTimeout(1500);
  
  // Step 4: Get ALL visible options and just pick the first one
  const options = await page.evaluate(() => {
    const allOptions = Array.from(document.querySelectorAll('li[role="option"], li'));
    return allOptions
      .filter(opt => {
        const rect = (opt as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((opt, idx) => ({
        idx,
        text: opt.textContent?.trim().substring(0, 80) || '',
      }));
  });
  
  console.log(`   Found ${options.length} visible options:`);
  options.slice(0, 10).forEach(o => console.log(`     [${o.idx}] ${o.text}`));
  
  await screenshot(page, `${screenshotPrefix}_03_dropdown`);
  await debugDOM(page, `${screenshotPrefix}_03_dropdown`);
  
  if (options.length === 0) {
    console.log('   ✗ No visible options');
    return false;
  }
  
  // Step 5: Click the FIRST visible option
  console.log(`   📍 Clicking FIRST option: "${options[0].text}"`);
  
  // Click first visible option
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
  
  console.log('   ✅ Clicked first visible dropdown option');
  
  // Step 6: Press Tab to blur and commit
  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  
  await screenshot(page, `${screenshotPrefix}_04_committed`);
  
  // Step 7: Verify the selection was committed
  const committed = await page.evaluate((label: string) => {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    const inputHidden = !input || input.offsetParent === null;
    const inputValue = input?.value?.trim() || '';
    
    // Check body text for airport code (3 uppercase letters)
    const bodyText = document.body.innerText;
    const airportMatch = bodyText.match(/\b[A-Z]{3}\b/);
    
    return {
      inputHidden,
      inputValue,
      detectedAirport: airportMatch ? airportMatch[0] : null,
      bodySnippet: bodyText.substring(0, 400),
    };
  }, ariaLabel);
  
  console.log(`   Commit verification:`);
  console.log(`     inputHidden: ${committed.inputHidden}`);
  console.log(`     inputValue: "${committed.inputValue}"`);
  console.log(`     detectedAirport: ${committed.detectedAirport}`);
  
  const success = committed.inputHidden || committed.inputValue.length > 0 || committed.detectedAirport !== null;
  
  if (success) {
    console.log(`   ✅ ${fieldType.toUpperCase()} COMMITTED`);
  } else {
    console.log(`   ❌ ${fieldType.toUpperCase()} NOT COMMITTED`);
  }
  
  return success;
}

async function setDate(page: Page, isoDate: string): Promise<boolean> {
  console.log(`\n🎯 Setting departure date: ${isoDate}...`);
  
  const [year, month, day] = isoDate.split('-').map(Number);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthNamesShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  
  const targetMonthName = monthNames[month - 1];
  const targetMonthShort = monthNamesShort[month - 1];
  const targetDay = day.toString();
  
  console.log(`   📅 Target: ${targetMonthName} ${targetDay}, ${year}`);
  
  // Step 1: Click departure date field to open calendar
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
      console.log(`   ✓ Clicked date field via "${sel}"`);
      opened = true;
      break;
    }
  }
  
  if (!opened) {
    console.log('   ✗ Could not open date picker');
    await screenshot(page, '05_date_FAIL_no_picker');
    return false;
  }
  
  await screenshot(page, '05_date_01_picker_open');
  
  // Step 2: Check what month is currently visible in the calendar
  const calendarInfo = await page.evaluate(() => {
    // Look for month header or aria-label with month name
    const headers = Array.from(document.querySelectorAll('[role="heading"], h2, h3, .gws-flights-form__month-name'));
    const monthHeaders = headers.filter(h => {
      const text = h.textContent || '';
      return /January|February|March|April|May|June|July|August|September|October|November|December/.test(text);
    });
    
    return {
      foundHeaders: monthHeaders.length,
      firstHeader: monthHeaders[0]?.textContent?.trim() || null,
      allHeaders: monthHeaders.map(h => h.textContent?.trim()).filter(Boolean),
    };
  });
  
  console.log(`   📆 Calendar opened: ${calendarInfo.foundHeaders} month header(s) found`);
  if (calendarInfo.firstHeader) {
    console.log(`   📆 Current month visible: ${calendarInfo.firstHeader}`);
  }
  if (calendarInfo.allHeaders.length > 1) {
    console.log(`   📆 Multiple months: ${calendarInfo.allHeaders.join(', ')}`);
  }
  
  // Step 3: Navigate to the correct month if needed
  const targetYearMonth = `${year}-${month.toString().padStart(2, '0')}`;
  let navAttempts = 0;
  const maxNavAttempts = 6;
  
  while (navAttempts < maxNavAttempts) {
    // Check if target month is visible
    const monthVisible = await page.evaluate((targetMonth: string) => {
      const bodyText = document.body.innerText;
      return bodyText.includes(targetMonth);
    }, targetMonthName);
    
    if (monthVisible) {
      console.log(`   ✓ Target month "${targetMonthName}" is visible`);
      break;
    }
    
    // Need to navigate - click next month button
    console.log(`   ⏭️  Navigating to next month (attempt ${navAttempts + 1})...`);
    
    const nextButton = page.locator('[aria-label*="Next month"], button[aria-label*="next"]').first();
    if (await nextButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nextButton.click();
      await page.waitForTimeout(500);
      navAttempts++;
    } else {
      console.log(`   ⚠️  Could not find next month button`);
      break;
    }
  }
  
  if (navAttempts > 0) {
    await screenshot(page, '05_date_02_navigated_month');
  }
  
  // Step 3.5: Debug - inspect calendar structure
  const calendarDebug = await page.evaluate(() => {
    // Find all elements that could be day cells
    const allElements = Array.from(document.querySelectorAll('td, button, div, span, [role="gridcell"], [role="button"]'));
    
    return allElements
      .map(el => {
        const text = el.textContent?.trim() || '';
        const rect = (el as HTMLElement).getBoundingClientRect();
        
        return {
          tag: el.tagName,
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          text: text.substring(0, 50),
          classes: el.className.substring(0, 50),
          visible: rect.width > 0 && rect.height > 0,
          isNumeric: /^\d{1,2}$/.test(text),
        };
      })
      .filter(el => {
        // Keep only visible elements with numeric text (potential day cells)
        return el.visible && el.isNumeric && parseInt(el.text) >= 1 && parseInt(el.text) <= 31;
      })
      .slice(0, 40); // First 40 day cells
  });
  
  console.log(`   🔍 Calendar debug: Found ${calendarDebug.length} visible numeric elements (potential day cells):`);
  calendarDebug.slice(0, 15).forEach((el, idx) => {
    console.log(`     [${idx}] ${el.tag} role="${el.role}" aria-label="${el.ariaLabel}" text="${el.text}" class="${el.classes}"`);
  });
  
  // Step 4: Find and click the day cell using aria-label
  // Google Flights uses format: "Monday, March 25, 2026" (with day of week)
  // We need to try all possible day-of-week prefixes
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ariaLabelFormats: string[] = [];
  
  // Try with each day of week prefix
  for (const dayOfWeek of daysOfWeek) {
    ariaLabelFormats.push(`${dayOfWeek}, ${targetMonthName} ${targetDay}, ${year}`);
  }
  
  // Also try without day of week
  ariaLabelFormats.push(`${targetMonthName} ${targetDay}, ${year}`);
  
  console.log(`   🔍 Searching for day cell with target day ${targetDay}...`);
  let dayClicked = false;
  
  for (const ariaLabel of ariaLabelFormats) {
    // Look for div with this aria-label (the actual clickable element)
    const selector = `div[aria-label="${ariaLabel}"], [aria-label="${ariaLabel}"]`;
    
    const dayCell = page.locator(selector).first();
    if (await dayCell.isVisible({ timeout: 500 }).catch(() => false)) {
      await dayCell.click();
      await page.waitForTimeout(800);
      console.log(`   ✅ Clicked day cell: "${ariaLabel}"`);
      dayClicked = true;
      break;
    }
  }
  
  if (!dayClicked) {
    // Fallback: Try to find any button/cell with the day number in the correct month
    console.log(`   ⚠️  Aria-label approach failed, trying fallback...`);
    
    const clicked = await page.evaluate((params: { month: string; day: string }) => {
      const { month, day } = params;
      
      // Find all buttons in gridcells
      const cells = Array.from(document.querySelectorAll('[role="gridcell"] button, [role="button"]'));
      
      for (const cell of cells) {
        const ariaLabel = cell.getAttribute('aria-label') || '';
        const text = cell.textContent?.trim() || '';
        
        // Check if this cell matches our target date
        if (ariaLabel.includes(month) && (ariaLabel.includes(day) || text === day)) {
          (cell as HTMLElement).click();
          return { success: true, ariaLabel, text };
        }
      }
      
      return { success: false, ariaLabel: null, text: null };
    }, { month: targetMonthName, day: targetDay });
    
    if (clicked.success) {
      await page.waitForTimeout(800);
      console.log(`   ✅ Clicked day cell (fallback): aria-label="${clicked.ariaLabel}", text="${clicked.text}"`);
      dayClicked = true;
    }
  }
  
  if (!dayClicked) {
    console.log('   ✗ Could not find or click day cell');
    await screenshot(page, '05_date_FAIL_no_day_cell');
    return false;
  }
  
  await screenshot(page, '05_date_03_day_clicked');
  
  // Step 5: Wait for calendar to close and verify the date was committed
  await page.waitForTimeout(1200);
  
  // Press Escape to ensure calendar closes
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  
  await screenshot(page, '05_date_04_committed');
  
  // Verify date is visible in the departure field
  const verification = await page.evaluate((params: { shortMonth: string; fullMonth: string; day: string; year: number }) => {
    const { shortMonth, fullMonth, day, year } = params;
    const bodyText = document.body.innerText;
    
    // Check for various date formats
    const patterns = [
      `${shortMonth} ${day}`,           // "Mar 25"
      `${fullMonth} ${day}`,            // "March 25"
      `${shortMonth} ${day}, ${year}`,  // "Mar 25, 2026"
      `${fullMonth} ${day}, ${year}`,   // "March 25, 2026"
    ];
    
    let dateVisible = false;
    let matchedPattern = '';
    for (const pattern of patterns) {
      if (bodyText.includes(pattern)) {
        dateVisible = true;
        matchedPattern = pattern;
        break;
      }
    }
    
    // Also check the departure input field directly
    const departureInputs = Array.from(document.querySelectorAll('input[placeholder*="Departure"], [aria-label*="Departure"]'));
    const departureFieldValue = departureInputs.length > 0 
      ? (departureInputs[0] as HTMLInputElement).value 
      : '';
    const departureFieldText = departureInputs.length > 0
      ? departureInputs[0].getAttribute('placeholder') || ''
      : '';
    
    // Check if search/explore button is enabled
    const searchButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const exploreButton = searchButtons.find(btn => {
      const text = btn.textContent?.toLowerCase() || '';
      return text.includes('search') || text.includes('explore');
    });
    const buttonEnabled = exploreButton ? !(exploreButton as HTMLButtonElement).disabled : null;
    
    return {
      dateVisible,
      matchedPattern,
      departureFieldValue,
      departureFieldText,
      bodySnippet: bodyText.substring(0, 500),
      buttonEnabled,
    };
  }, { shortMonth: targetMonthShort, fullMonth: targetMonthName, day: targetDay, year });
  
  console.log(`   📋 Verification:`);
  console.log(`     Date visible in body: ${verification.dateVisible}${verification.matchedPattern ? ` ("${verification.matchedPattern}")` : ''}`);
  console.log(`     Departure field value: "${verification.departureFieldValue}"`);
  console.log(`     Departure field placeholder: "${verification.departureFieldText}"`);
  console.log(`     Search button enabled: ${verification.buttonEnabled}`);
  
  const success = verification.dateVisible || 
                  verification.departureFieldValue.includes(targetDay) ||
                  verification.departureFieldValue.includes(targetMonthShort);
  
  if (success) {
    console.log(`   ✅ DEPARTURE DATE COMMITTED: ${targetMonthShort} ${targetDay}`);
    return true;
  } else {
    console.log(`   ❌ DEPARTURE DATE NOT VISIBLE IN UI`);
    console.log(`     Body snippet: ${verification.bodySnippet.substring(0, 200)}...`);
    return false;
  }
}

async function main() {
  console.log('🚀 Google Flights UI Interaction Prototype\n');
  console.log('Testing basic field interactions...\n');
  console.log(`Screenshots will be saved to: ${SCREENSHOT_DIR}\n`);
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    // Step 0: Navigate to Google Flights
    console.log('🌐 Opening Google Flights...');
    await page.goto('https://www.google.com/travel/flights?hl=en', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3500); // Wait longer for full render
    console.log(`   URL: ${page.url()}`);
    
    await screenshot(page, '00_page_loaded');
    await logFieldState(page, 'Initial state');
    
    // Dismiss consent if present
    const consentBtn = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click();
      await page.waitForTimeout(500);
      console.log('   Dismissed consent dialog');
    }
    
    // Step 1: Set one-way
    const oneWayOk = await setOneWay(page);
    if (!oneWayOk) {
      console.log('\n❌ FAILED: Could not set one-way trip type');
      await browser.close();
      process.exit(1);
    }
    await logFieldState(page, 'After one-way');
    
    // Step 2: Set origin
    const originOk = await setLocation(page, 'origin', 'New York', '03_origin');
    if (!originOk) {
      console.log('\n❌ FAILED: Origin not committed');
      await browser.close();
      process.exit(1);
    }
    await logFieldState(page, 'After origin');
    
    // Step 3: Set destination
    const destOk = await setLocation(page, 'destination', 'Detroit', '04_destination');
    if (!destOk) {
      console.log('\n❌ FAILED: Destination not committed');
      await browser.close();
      process.exit(1);
    }
    await logFieldState(page, 'After destination');
    
    // Step 4: Set date
    const dateOk = await setDate(page, '2026-03-25');
    if (!dateOk) {
      console.log('\n❌ FAILED: Date not committed');
      await browser.close();
      process.exit(1);
    }
    await logFieldState(page, 'After date');
    
    // Final screenshot
    await screenshot(page, '99_final_state');
    
    console.log('\n✅ SUCCESS: All fields committed!');
    console.log('\nFinal verification:');
    const finalState = await logFieldState(page, 'Final');
    
    console.log('\n📊 Summary:');
    console.log(`   Trip type: ${finalState.tripType}`);
    console.log(`   Origin hidden: ${!finalState.originVisible} (committed)`);
    console.log(`   Destination hidden: ${!finalState.destinationVisible} (committed)`);
    console.log(`   Screenshots saved to: ${SCREENSHOT_DIR}`);
    
    await page.waitForTimeout(2000);
    await browser.close();
    
  } catch (err) {
    console.error('\n❌ ERROR:', err);
    await screenshot(page, 'ERROR');
    await browser.close();
    process.exit(1);
  }
}

main();
