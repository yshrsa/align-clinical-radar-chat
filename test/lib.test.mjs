import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, buildGroundedPrompt, buildNewsSummaryPrompt, buildSummaryPrompt, gatewayAuthorized, mapD1EvidenceRow, mapNotionPage, normalizeEvidenceDocument, normalizeIndustryNewsDocument, ownerId, scoreArticle, searchTerms } from '../worker/lib.mjs';

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

test('news summary prompt is source-grounded and flags promotional evidence', () => {
  const prompt = buildNewsSummaryPrompt({ source_name: 'Official newsroom', title: 'Launch', snippet_en: 'Company announced a feature.' });
  assert.match(prompt, /推測、外部知識、数値の補完は禁止/);
  assert.match(prompt, /広告・プレスリリース・ホワイトペーパー/);
  assert.match(prompt, /Company announced a feature/);
});

test('industry news normalization preserves source, timestamps and archive metadata', () => {
  const article = normalizeIndustryNewsDocument({
    article_id: 'a1', title: 'Launch', url: 'https://example.test/a1', published_at_utc: '2026-10-10T01:02:03Z', source_name: 'Publisher',
    source_categories: ['Aligners'], summary_ja: '要約', key_takeaway_ja: '要点',
    first_seen_at_utc: '2026-10-09T00:00:00Z', last_seen_at_utc: '2026-10-10T00:00:00Z', article_sha256: 'abc'
  });
  assert.equal(article.source_name, 'Publisher');
  assert.equal(article.published_at_utc, '2026-10-10T01:02:03Z');
  assert.equal(article.source_categories_json, '["Aligners"]');
  assert.equal(article.summary_status, 'complete');
  assert.equal(article.first_seen_at_utc, '2026-10-09T00:00:00Z');
  assert.equal(article.last_seen_at_utc, '2026-10-10T00:00:00Z');
});

test('D1 evidence mapping restores arrays and bilingual summaries', () => {
  const article = mapD1EvidenceRow({ pmid: '1', title: 'Trial', abstract_en: 'English abstract', summary_ja: '日本語要約', authors_json: '["A"]', assets_json: '["invisalign"]', focal_related: 1 });
  assert.equal(article.summary_en, 'English abstract');
  assert.deepEqual(article.authors, ['A']);
  assert.deepEqual(article.assets, ['invisalign']);
  assert.equal(article.focal_related, true);
});

test('evidence normalization marks only seven-field summaries complete', () => {
  const complete = normalizeEvidenceDocument({ pmid: '1', title: 'Trial', evidence_sha256: 'hash', abstract_en: 'A', summary_ja: 's', key_takeaway_ja: 'k', why_matters_ja: 'w', study_type_ja: 'd', endpoints_ja: 'e', endpoint_results_ja: 'r', sample_size_ja: 'n' });
  const pending = normalizeEvidenceDocument({ pmid: '2', title: 'Pending', evidence_sha256: 'hash' });
  assert.equal(complete.summary_status, 'complete');
  assert.equal(complete.summary_en, 'A');
  assert.equal(pending.summary_status, 'pending');
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
