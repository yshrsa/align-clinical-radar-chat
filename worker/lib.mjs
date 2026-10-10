export const MODEL = '@cf/qwen/qwen3.8-27b';
export const RESERVE_NEURONS_PER_CHAT = 600;
export const RESERVE_NEURONS_PER_SUMMARY = 500;

const PRODUCTION_ORIGIN = 'https://align-clinical-radar-chat.pages.dev';

export function allowedOrigin(request) {
  const origin = request?.headers?.get('Origin') || '';
  if (origin === PRODUCTION_ORIGIN) return origin;
  if (/^https:\/\/[a-f0-9]+\.align-clinical-radar-chat\.pages\.dev$/.test(origin)) return origin;
  if (origin === 'http://127.0.0.1:8787' || origin === 'http://localhost:8787') return origin;
  return null;
}

export function corsHeaders(request) {
  const origin = allowedOrigin(request);
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

export function jsonResponse(payload, status = 200, request = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request)
    }
  });
}

export function ownerId(request) {
  return String(request.headers.get('X-Authenticated-Owner') || '').trim().toLowerCase().slice(0, 200);
}

export function gatewayAuthorized(request, env) {
  const expected = String(env.PAGE_GATEWAY_SECRET || '');
  const supplied = String(request.headers.get('X-Page-Gateway-Secret') || '');
  return Boolean(expected && supplied && expected === supplied && ownerId(request));
}

export function plainText(property, kind = 'rich_text') {
  const values = property?.[kind] || [];
  return values.map(value => value?.plain_text || value?.text?.content || '').join('').trim();
}

export function mapNotionPage(page) {
  const p = page.properties || {};
  const pmid = plainText(p.PMID);
  return {
    id: page.id,
    pmid,
    title: plainText(p.Title, 'title'),
    url: p.URL?.url || (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : ''),
    publication_date: p['Publication Date']?.date?.start || '',
    journal: plainText(p.Journal),
    publication_types: (p['Publication Types']?.multi_select || []).map(item => item.name),
    assets: (p.Assets?.multi_select || []).map(item => item.name),
    focal_related: Boolean(p['Focal Related']?.checkbox),
    japan_relevant: Boolean(p['Japan Relevant']?.checkbox),
    summary_ja: plainText(p['Summary JA']),
    key_takeaway_ja: plainText(p['Key Takeaway JA']),
    why_matters_ja: plainText(p['Why Matters JA']),
    study_type_ja: plainText(p['Study Type JA']),
    endpoints_ja: plainText(p['Endpoints JA']),
    endpoint_results_ja: plainText(p['Endpoint Results JA']),
    sample_size_ja: plainText(p['Sample Size JA'])
  };
}

export function searchTerms(query) {
  return [...new Set(String(query || '').toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) || [])].slice(0, 6);
}

export function scoreArticle(article, terms) {
  const haystack = [article.title, article.summary_ja, article.key_takeaway_ja, article.why_matters_ja, ...(article.assets || [])].join(' ').toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) + (article.focal_related ? 0.1 : 0);
}

export function buildGroundedPrompt(question, articles) {
  const evidence = articles.map((article, index) => [
    `[${index + 1}] ${article.title}`,
    `PMID: ${article.pmid || '不明'} / Date: ${article.publication_date || '不明'} / Journal: ${article.journal || '不明'}`,
    `要約: ${article.summary_ja || '抄録に記載なし'}`,
    `要点: ${article.key_takeaway_ja || '抄録に記載なし'}`,
    `試験デザイン: ${article.study_type_ja || '抄録に記載なし'}`,
    `エンドポイント: ${article.endpoints_ja || '抄録に記載なし'}`,
    `結果: ${article.endpoint_results_ja || '抄録に記載なし'}`,
    `症例数: ${article.sample_size_ja || '抄録に記載なし'}`,
    `URL: ${article.url || ''}`
  ].join('\n')).join('\n\n');
  return `あなたはクリアアライナー治療とClinical Operations領域のEvidence Radarです。\n` +
    `以下の検索結果だけを根拠に日本語で回答してください。根拠のない補完は禁止です。\n` +
    `主張の直後に[1]の形式で引用番号を付け、情報が不足する場合は明記してください。\n` +
    `数値は提示された文献情報に存在するものだけを使ってください。\n\n質問: ${question}\n\n検索結果:\n${evidence}`;
}

export function buildSummaryPrompt(article) {
  return `あなたはAlign TechnologyのClinical / Treatment Planning Operationsの視点を持つ医学文献アナリストです。\n` +
    `与えられた論文情報だけを根拠に、指定された7フィールドのJSONオブジェクトだけを返してください。\n` +
    `抄録から読み取れない項目は、推測せず必ず文字列「抄録に記載なし」にしてください。\n` +
    `endpoint_results_jaには抄録に実際に書かれた生の数値だけを使い、補完・換算・推定を禁止します。\n` +
    `why_matters_jaは計画品質、planned-vs-achieved、refinement、教育、安全性、ワークフローのうち抄録に根拠がある観点だけを書いてください。\n` +
    `フィールド: summary_ja, key_takeaway_ja, why_matters_ja, study_type_ja, endpoints_ja, endpoint_results_ja, sample_size_ja\n\n` +
    `Title: ${article.title || ''}\nJournal: ${article.journal || ''}\n` +
    `Publication Type: ${(article.publication_types || []).join(', ')}\nAbstract: ${article.abstract || '[no abstract available]'}`;
}
