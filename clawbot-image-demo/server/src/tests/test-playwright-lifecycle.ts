import { getSessionPage, getMostRecentSessionPage, resetSession, getSessionStatus } from '../connector/browserTools/playwrightManager.js';

async function testLifecycle() {
  console.log('\n=== Playwright lifecycle test START ===');

  // Test A: getPage and goto ChatGPT
  console.log('\n[Test A] getSessionPage() -> navigate to https://chat.openai.com (ChatGPT)');
  try {
    const page = await getSessionPage('lifecycle-test');
    console.log('[Test A] page acquired, url before:', page.url());
    await page.goto('https://chat.openai.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[Test A] goto succeeded, url now:', page.url());
  } catch (e: any) {
    console.error('[Test A] failed:', e?.message ?? e);
    process.exit(1);
  }

  // Test B: call getPage again and navigate to Google
  console.log('\n[Test B] getSessionPage() again -> navigate to https://www.google.com');
  try {
    const { page } = await getMostRecentSessionPage();
    console.log('[Test B] most recent page url before:', page.url());
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[Test B] goto succeeded, url now:', page.url());
  } catch (e: any) {
    console.error('[Test B] failed:', e?.message ?? e);
    process.exit(1);
  }

  // Test C: close current page, then getPage and navigate to Amazon
  console.log('\n[Test C] closing current page, then calling getSessionPage() to ensure a new page is created');
  try {
    const { page, sessionId } = await getMostRecentSessionPage();
    console.log('[Test C] closing page for session:', sessionId);
    await page.close();
    console.log('[Test C] page closed');

    // Give a small moment
    await new Promise((r) => setTimeout(r, 500));

    const page2 = await getSessionPage('lifecycle-test');
    console.log('[Test C] got page after close, url before goto:', page2.url());
    await page2.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[Test C] goto succeeded, url now:', page2.url());
  } catch (e: any) {
    console.error('[Test C] failed:', e?.message ?? e);
    process.exit(1);
  }

  console.log('\n=== Playwright lifecycle test PASSED ===');
  console.log('Session status snapshot:', getSessionStatus());
  process.exit(0);
}

// Run immediately when invoked with tsx
testLifecycle();
