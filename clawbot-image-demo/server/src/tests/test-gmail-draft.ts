#!/usr/bin/env -S tsx
import { composeGmailDraft } from "../connector/browserTools/tasks/composeGmailDraft.js";

async function run() {
  console.log('Starting Gmail draft test...');
  const result = await composeGmailDraft({
    to: 'ruiyawang97@gmail.com',
    subject: 'Hello',
    body: 'This is a test email from Alfred',
  });

  console.log('Result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

run().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
