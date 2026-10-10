import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, buildGroundedPrompt, buildSummaryPrompt, gatewayAuthorized, mapNotionPage, ownerId, scoreArticle, searchTerms } from '../worker/lib.mjs';

test('searchTerms extracts English and Japanese terms', () => {
  assert.deepEqual(searchTerms('Invisalign の refinement 結果'), ['invisalign', 'refinement', '結果']);
});

test('article scoring is evidence-field based', () => {
  const article = { title: 'Invisalign treatment predictability', summary_ja: '', key_takeaway_ja: '', why_matters_ja: '', assets: ['invisalign'], focal_related: true };
  assert.ok(scoreArticle(article, ['invisalign']) > scoreArticle(article, ['clearcorrect']));
  assert.ok(scoreArticle(article, ['clearcorrect']) < 1);
});

test('grounded prompt includes citation identifiers and anti-fabrication rule', () => {
  const prompt = buildGroundedPrompt('結果は？', [{ title: 'Trial', pmid: '123', url: 'https://pubmed.test/123', summary_ja: '要約' }]);
  assert.match(prompt, /\[1\] Trial/);
  assert.match(prompt, /PMID: 123/);
  assert.match(prompt, /根拠に日本語で回答/);
});

test('Notion page mapping preserves focal relation and seven summary fields', () => {
  const text = value => ({ rich_text: [{ plain_text: value }] });
  const page = { id: 'p', properties: { Title: { title: [{ plain_text: 'T' }] }, PMID: text('1'), 'Focal Related': { checkbox: true }, 'Summary JA': text('s'), 'Key Takeaway JA': text('k'), 'Why Matters JA': text('w'), 'Study Type JA': text('d'), 'Endpoints JA': text('e'), 'Endpoint Results JA': text('r'), 'Sample Size JA': text('n') } };
  const article = mapNotionPage(page);
  assert.equal(article.focal_related, true);
  assert.equal(article.sample_size_ja, 'n');
  assert.equal(article.endpoint_results_ja, 'r');
});

test('summary prompt requires the exact missing-information sentinel', () => {
  const prompt = buildSummaryPrompt({ title: 'Trial', abstract: 'N=100' });
  assert.match(prompt, /抄録に記載なし/);
  assert.match(prompt, /補完・換算・推定を禁止/);
  assert.match(prompt, /N=100/);
});

test('CORS accepts only the production Pages origin and preview deployments', () => {
  const request = origin => new Request('https://worker.test/api/chat', { headers: { Origin: origin } });
  assert.equal(allowedOrigin(request('https://align-clinical-radar-chat.pages.dev')), 'https://align-clinical-radar-chat.pages.dev');
  assert.equal(allowedOrigin(request('https://d102a994.align-clinical-radar-chat.pages.dev')), 'https://d102a994.align-clinical-radar-chat.pages.dev');
  assert.equal(allowedOrigin(request('https://attacker.example')), null);
});

test('history owner is accepted only through the authenticated Pages gateway', () => {
  const request = new Request('https://worker.test/api/threads', { headers: {
    'X-Authenticated-Owner': 'User@Example.com',
    'X-Page-Gateway-Secret': 'secret'
  }});
  assert.equal(ownerId(request), 'user@example.com');
  assert.equal(gatewayAuthorized(request, { PAGE_GATEWAY_SECRET: 'secret' }), true);
  assert.equal(gatewayAuthorized(request, { PAGE_GATEWAY_SECRET: 'wrong' }), false);
});
