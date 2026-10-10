export const MODEL = '@cf/qwen/qwen3.8-27b';
export const RESERVE_NEURONS_PER_CHAT = 600;
export const RESERVE_NEURONS_PER_SUMMARY = 500;
export const RESERVE_NEURONS_PER_NEWS_SUMMARY = 250;

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

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapD1EvidenceRow(row) {
  return {
    pmid: String(row.pmid || ''),
    title: String(row.title || ''),
    abstract_en: String(row.abstract_en || ''),
    summary_en: String(row.summary_en || row.abstract_en || ''),
    summary_ja: String(row.summary_ja || ''),
    key_takeaway_ja: String(row.key_takeaway_ja || ''),
    why_matters_ja: String(row.why_matters_ja || ''),
    study_type_ja: String(row.study_type_ja || ''),
    endpoints_ja: String(row.endpoints_ja || ''),
    endpoint_results_ja: String(row.endpoint_results_ja || ''),
    sample_size_ja: String(row.sample_size_ja || ''),
    journal: String(row.journal || ''),
    authors: parseJsonArray(row.authors_json),
    publication_date: String(row.publication_date || ''),
    doi: String(row.doi || ''),
    url: String(row.url || ''),
    publication_types: parseJsonArray(row.publication_types_json),
    mesh_terms: parseJsonArray(row.mesh_terms_json),
    assets: parseJsonArray(row.assets_json),
    companies: parseJsonArray(row.companies_json),
    topics: parseJsonArray(row.topics_json),
    focal_related: Boolean(row.focal_related),
    japan_relevant: Boolean(row.japan_relevant),
    summary_status: String(row.summary_status || 'pending')
  };
}

export function normalizeEvidenceDocument(document) {
  const text = key => String(document?.[key] || '').trim();
  const list = key => Array.isArray(document?.[key]) ? document[key].map(value => String(value)).filter(Boolean) : [];
  const pmid = text('pmid');
  const title = text('title');
  const evidenceSha256 = text('evidence_sha256');
  if (!pmid || !title || !evidenceSha256) throw new Error('pmid, title and evidence_sha256 are required');
  const summaryFields = ['summary_ja', 'key_takeaway_ja', 'why_matters_ja', 'study_type_ja', 'endpoints_ja', 'endpoint_results_ja', 'sample_size_ja'];
  const complete = summaryFields.every(key => text(key));
  return {
    pmid, title,
    abstract_en: text('abstract_en'),
    summary_en: text('summary_en') || text('abstract_en'),
    summary_ja: text('summary_ja'),
    key_takeaway_ja: text('key_takeaway_ja'),
    why_matters_ja: text('why_matters_ja'),
    study_type_ja: text('study_type_ja'),
    endpoints_ja: text('endpoints_ja'),
    endpoint_results_ja: text('endpoint_results_ja'),
    sample_size_ja: text('sample_size_ja'),
    journal: text('journal'),
    authors_json: JSON.stringify(list('authors')),
    publication_date: text('publication_date'),
    doi: text('doi'),
    url: text('url'),
    publication_types_json: JSON.stringify(list('publication_types')),
    mesh_terms_json: JSON.stringify(list('mesh_terms')),
    assets_json: JSON.stringify(list('assets')),
    companies_json: JSON.stringify(list('companies')),
    topics_json: JSON.stringify(list('topics')),
    focal_related: document?.focal_related ? 1 : 0,
    japan_relevant: document?.japan_relevant ? 1 : 0,
    source_content_sha256: text('source_content_sha256'),
    evidence_sha256: evidenceSha256,
    fetched_at_utc: text('fetched_at_utc'),
    source_updated_at_utc: text('source_updated_at_utc'),
    summary_model: text('summary_model'),
    summary_generated_at_utc: text('summary_generated_at_utc'),
    summary_status: complete ? 'complete' : 'pending'
  };
}

export function normalizeIndustryNewsDocument(document) {
  const text = key => String(document?.[key] || '').trim();
  const list = key => Array.isArray(document?.[key]) ? document[key].map(value => String(value)).filter(Boolean) : [];
  const articleId = text('article_id');
  const title = text('title');
  const url = text('url');
  const articleSha256 = text('article_sha256');
  const seenAt = text('last_seen_at_utc');
  if (!articleId || !title || !url || !articleSha256 || !seenAt) {
    throw new Error('article_id, title, url, article_sha256 and last_seen_at_utc are required');
  }
  return {
    article_id: articleId,
    title,
    url,
    published_date: text('published_date'),
    published_at_utc: text('published_at_utc'),
    source_id: text('source_id'),
    source_name: text('source_name'),
    source_url: text('source_url'),
    feed_url: text('feed_url'),
    source_category: text('source_category'),
    source_categories_json: JSON.stringify(list('source_categories')),
    snippet_en: text('snippet_en'),
    summary_ja: text('summary_ja'),
    key_takeaway_ja: text('key_takeaway_ja'),
    assets_json: JSON.stringify(list('assets')),
    companies_json: JSON.stringify(list('companies')),
    topics_json: JSON.stringify(list('topics')),
    focal_related: document?.focal_related ? 1 : 0,
    japan_relevant: document?.japan_relevant ? 1 : 0,
    summary_model: text('summary_model'),
    summary_generated_at_utc: text('summary_generated_at_utc'),
    summary_status: text('summary_ja') && text('key_takeaway_ja') ? 'complete' : 'pending',
    first_seen_at_utc: text('first_seen_at_utc') || seenAt,
    last_seen_at_utc: seenAt,
    article_sha256: articleSha256
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

export function buildNewsSummaryPrompt(article) {
  return `あなたは歯科・医療機器業界ニュースの編集者です。\n` +
    `以下の配信元タイトルと抜粋だけを根拠に、JSONオブジェクトだけを返してください。\n` +
    `推測、外部知識、数値の補完は禁止です。広告・プレスリリース・ホワイトペーパーの場合は断定的な臨床事実として扱わず、その性質が分かる表現にしてください。\n` +
    `summary_jaは自然な日本語で2文以内、key_takeaway_jaはClinical Operations・治療計画・業務運用への要点を1文で記載してください。\n` +
    `根拠がない場合は「配信元抜粋に記載なし」としてください。\n` +
    `フィールド: summary_ja, key_takeaway_ja\n\n` +
    `Source: ${article.source_name || ''}\nTitle: ${article.title || ''}\nExcerpt: ${article.snippet_en || '[no excerpt provided]'}`;
}
