import test from 'node:test';
import assert from 'node:assert/strict';

import { searchCorpus } from '../worker/index.mjs';

test('search falls back to the validated public feed when D1 is unavailable', async () => {
  const item = {
    pmid: '123',
    title: 'Invisalign refinement study',
    publication_date: '2026-10-01',
    summary_ja: 'refinementの結果',
    assets: ['invisalign']
  };
  const env = {
    CHAT_DB: { prepare: () => ({ all: async () => { throw new Error('D1 unavailable'); } }) },
    PUBLIC_FEED_URL: `data:application/json,${encodeURIComponent(JSON.stringify({ items: [item] }))}`
  };
  const results = await searchCorpus(env, 'Invisalign refinement', 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].pmid, '123');
});
