#!/usr/bin/env -S tsx
import { getSessionPage, resetSession } from "../connector/browserTools/playwrightManager.js";
import { openPage } from "../connector/browserTools/tasks/openPage.js";
import { searchWeb } from "../connector/browserTools/tasks/searchWeb.js";

async function run() {
  console.log('Basic browser lifecycle test start');

  // 1) getPage first call (session 'basic') and open ChatGPT
  const page1 = await getSessionPage('basic');
  console.log('got page1, url:', await page1.url().catch(() => 'no-url'));
  const open = await openPage({ url: 'chatgpt' });
  console.log('openPage:', open.success, open.finalUrl || open.error);

  // 2) getPage second call should reuse live page
  const page2 = await getSessionPage('basic');
  console.log('got page2, same object as page1?', page1 === page2);

  // 3) manually close current page to simulate external close
  try {
    await page2.close();
    console.log('manually closed page2');
  } catch (e) {
    console.warn('error closing page2', e);
  }

  // 4) getPage should create a new tab in same context
  const page3 = await getSessionPage('basic');
  console.log('got page3, page1===page3?', page1 === page3);

  // 5) navigate to amazon using openPage (uses session 'open-page') to ensure new tab works
  const openAmazon = await openPage({ url: 'amazon' });
  console.log('openPage amazon:', openAmazon.success, openAmazon.finalUrl || openAmazon.error);

  // 6) basic search
  const search = await searchWeb({ query: 'Ann Arbor weather' });
  console.log('searchWeb success:', search.success, 'results:', (search.results||[]).slice(0,2).map(r=>r.title));

  console.log('Basic browser lifecycle test complete');
  process.exit(0);
}

run().catch((e)=>{ console.error('test failed', e); process.exit(1); });
