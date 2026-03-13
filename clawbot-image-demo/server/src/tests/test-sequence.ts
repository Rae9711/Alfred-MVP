#!/usr/bin/env -S tsx
import { openPage } from "../connector/browserTools/tasks/openPage.js";
import { searchWeb } from "../connector/browserTools/tasks/searchWeb.js";
import { composeGmailDraft } from "../connector/browserTools/tasks/composeGmailDraft.js";

async function run() {
  console.log('Starting sequence test: open ChatGPT -> search Ann Arbor weather -> draft Gmail');

  const open = await openPage({ url: 'chatgpt' });
  console.log('openPage result:', open);

  const search = await searchWeb({ query: 'Ann Arbor weather' });
  console.log('searchWeb result:', { success: search.success, results: search.results?.slice(0,2) });

  const draft = await composeGmailDraft({ to: 'ruiyawang97@gmail.com', subject: 'Hello', body: 'This is a test email from Alfred' });
  console.log('composeGmailDraft result:', draft);

  process.exit(0);
}

run().catch((e) => { console.error('Sequence test failed:', e); process.exit(1); });
