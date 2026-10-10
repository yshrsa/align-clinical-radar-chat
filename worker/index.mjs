import { MODEL, RESERVE_NEURONS_PER_CHAT, RESERVE_NEURONS_PER_NEWS_SUMMARY, RESERVE_NEURONS_PER_SUMMARY, allowedOrigin, buildGroundedPrompt, buildNewsSummaryPrompt, buildSummaryPrompt, corsHeaders, gatewayAuthorized, jsonResponse, mapD1EvidenceRow, mapNotionPage, normalizeEvidenceDocument, normalizeIndustryNewsDocument, ownerId, scoreArticle, searchTerms } from './lib.mjs';

const NOTION_QUERY_URL = databaseId => `https://api.notion.com/v1/databases/${databaseId}/query`;

async function notionRequest(env, body) {
  const response = await fetch(NOTION_QUERY_URL(env.NOTION_DATABASE_ID), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.NOTION_API_KEY}`,
      'notion-version': env.NOTION_VERSION || '2022-06-28',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Notion query failed: ${response.status}`);
  return response.json();
}

async function publicFeed(env) {
  const response = await fetch(env.PUBLIC_FEED_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new Error(`Public evidence feed failed: ${response.status}`);
  const payload = await response.json();
  return payload.items || [];
}

async function d1Evidence(env) {
  const result = await env.CHAT_DB.prepare(
    "SELECT * FROM evidence_documents WHERE summary_status='complete' ORDER BY publication_date DESC LIMIT 500"
  ).all();
  return (result.results || []).map(mapD1EvidenceRow);
}

async function evidenceCounts(env) {
  const row = await env.CHAT_DB.prepare(
    "SELECT COUNT(*) AS documents, SUM(CASE WHEN summary_status='complete' THEN 1 ELSE 0 END) AS searchable FROM evidence_documents"
  ).first();
  return { documents: Number(row?.documents || 0), searchable: Number(row?.searchable || 0) };
}

async function industryNewsCounts(env) {
  const row = await env.CHAT_DB.prepare(
    "SELECT COUNT(*) AS documents, SUM(CASE WHEN summary_status='complete' THEN 1 ELSE 0 END) AS summarized FROM industry_news"
  ).first();
  return { documents: Number(row?.documents || 0), summarized: Number(row?.summarized || 0) };
}

export async function searchCorpus(env, query, limit = 8) {
  const terms = searchTerms(query);
  let articles;
  try {
    articles = await d1Evidence(env);
    if (!articles.length) throw new Error('D1 evidence table is empty');
  } catch (error) {
    console.warn('D1 evidence unavailable; trying secondary corpus', error);
  }
  if (!articles && env.NOTION_API_KEY && env.NOTION_DATABASE_ID) {
    const filters = terms.slice(0, 3).flatMap(term => [
      { property: 'Title', title: { contains: term } },
      { property: 'Summary JA', rich_text: { contains: term } },
      { property: 'Assets', multi_select: { contains: term } }
    ]);
    try {
      const payload = await notionRequest(env, { filter: filters.length ? { or: filters } : undefined, page_size: 50 });
      articles = (payload.results || []).map(mapNotionPage);
    } catch (error) {
      console.warn('Notion unavailable; using validated public feed', error);
      articles = await publicFeed(env);
    }
  } else if (!articles) {
    articles = await publicFeed(env);
  }
  return articles
    .map(article => ({ article, score: scoreArticle(article, terms) }))
    .filter(item => !terms.length || item.score >= 1)
    .sort((a, b) => b.score - a.score || String(b.article.publication_date).localeCompare(String(a.article.publication_date)))
    .slice(0, limit).map(item => item.article);
}

function ingestAuthorized(request, env) {
  const expected = String(env.INGEST_SECRET || '');
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(expected && supplied && expected === supplied);
}

async function evidenceState(env) {
  const [documents, state] = await Promise.all([
    env.CHAT_DB.prepare('SELECT pmid,evidence_sha256 FROM evidence_documents').all(),
    env.CHAT_DB.prepare("SELECT * FROM evidence_sync_state WHERE source='github-corpus'").first()
  ]);
  return {
    hashes: Object.fromEntries((documents.results || []).map(row => [String(row.pmid), String(row.evidence_sha256)])),
    state: state || null
  };
}

async function syncEvidence(env, body) {
  const documents = Array.isArray(body?.documents) ? body.documents : [];
  if (documents.length > 25) throw new Error('A sync batch may contain at most 25 documents');
  const normalized = documents.map(normalizeEvidenceDocument);
  const now = new Date().toISOString();
  const sql = `INSERT INTO evidence_documents(
    pmid,title,abstract_en,summary_en,summary_ja,key_takeaway_ja,why_matters_ja,study_type_ja,endpoints_ja,endpoint_results_ja,sample_size_ja,
    journal,authors_json,publication_date,doi,url,publication_types_json,mesh_terms_json,assets_json,companies_json,topics_json,
    focal_related,japan_relevant,source_content_sha256,evidence_sha256,fetched_at_utc,source_updated_at_utc,summary_model,summary_generated_at_utc,summary_status,synced_at_utc
  ) VALUES(${Array(31).fill('?').join(',')}) ON CONFLICT(pmid) DO UPDATE SET
    title=excluded.title,abstract_en=excluded.abstract_en,summary_en=excluded.summary_en,summary_ja=excluded.summary_ja,
    key_takeaway_ja=excluded.key_takeaway_ja,why_matters_ja=excluded.why_matters_ja,study_type_ja=excluded.study_type_ja,
    endpoints_ja=excluded.endpoints_ja,endpoint_results_ja=excluded.endpoint_results_ja,sample_size_ja=excluded.sample_size_ja,
    journal=excluded.journal,authors_json=excluded.authors_json,publication_date=excluded.publication_date,doi=excluded.doi,url=excluded.url,
    publication_types_json=excluded.publication_types_json,mesh_terms_json=excluded.mesh_terms_json,assets_json=excluded.assets_json,
    companies_json=excluded.companies_json,topics_json=excluded.topics_json,focal_related=excluded.focal_related,japan_relevant=excluded.japan_relevant,
    source_content_sha256=excluded.source_content_sha256,evidence_sha256=excluded.evidence_sha256,fetched_at_utc=excluded.fetched_at_utc,
    source_updated_at_utc=excluded.source_updated_at_utc,summary_model=excluded.summary_model,
    summary_generated_at_utc=excluded.summary_generated_at_utc,summary_status=excluded.summary_status,synced_at_utc=excluded.synced_at_utc
    WHERE evidence_documents.evidence_sha256<>excluded.evidence_sha256`;
  const statements = normalized.map(document => env.CHAT_DB.prepare(sql).bind(
    document.pmid, document.title, document.abstract_en, document.summary_en, document.summary_ja, document.key_takeaway_ja,
    document.why_matters_ja, document.study_type_ja, document.endpoints_ja, document.endpoint_results_ja, document.sample_size_ja,
    document.journal, document.authors_json, document.publication_date, document.doi, document.url, document.publication_types_json,
    document.mesh_terms_json, document.assets_json, document.companies_json, document.topics_json, document.focal_related,
    document.japan_relevant, document.source_content_sha256, document.evidence_sha256, document.fetched_at_utc,
    document.source_updated_at_utc, document.summary_model, document.summary_generated_at_utc, document.summary_status, now
  ));
  const results = statements.length ? await env.CHAT_DB.batch(statements) : [];
  const mode = body?.mode === 'full' ? 'full' : 'delta';
  await env.CHAT_DB.prepare(
    `INSERT INTO evidence_sync_state(source,source_generated_at_utc,document_count,last_full_sync_at_utc,last_delta_sync_at_utc,updated_at_utc)
     VALUES('github-corpus',?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET
     source_generated_at_utc=excluded.source_generated_at_utc,document_count=excluded.document_count,
     last_full_sync_at_utc=COALESCE(excluded.last_full_sync_at_utc,evidence_sync_state.last_full_sync_at_utc),
     last_delta_sync_at_utc=excluded.last_delta_sync_at_utc,updated_at_utc=excluded.updated_at_utc`
  ).bind(String(body?.source_generated_at_utc || ''), Number(body?.source_document_count || 0), mode === 'full' ? now : null, now, now).run();
  return { mode, received: normalized.length, upserted: results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0), synced_at_utc: now };
}

async function industryNewsState(env) {
  const [documents, state] = await Promise.all([
    env.CHAT_DB.prepare('SELECT article_id,article_sha256 FROM industry_news').all(),
    env.CHAT_DB.prepare("SELECT * FROM industry_news_sync_state WHERE source='github-industry-news'").first()
  ]);
  return {
    hashes: Object.fromEntries((documents.results || []).map(row => [String(row.article_id), String(row.article_sha256)])),
    state: state || null
  };
}

async function syncIndustryNews(env, body) {
  const documents = Array.isArray(body?.documents) ? body.documents : [];
  if (documents.length > 25) throw new Error('A sync batch may contain at most 25 documents');
  const normalized = documents.map(normalizeIndustryNewsDocument);
  const now = new Date().toISOString();
  const sql = `INSERT INTO industry_news(
    article_id,title,url,published_date,source_id,source_name,source_url,feed_url,source_category,source_categories_json,
    snippet_en,summary_ja,key_takeaway_ja,assets_json,companies_json,topics_json,focal_related,japan_relevant,
    summary_model,summary_generated_at_utc,summary_status,first_seen_at_utc,last_seen_at_utc,article_sha256,synced_at_utc
  ) VALUES(${Array(25).fill('?').join(',')}) ON CONFLICT(article_id) DO UPDATE SET
    title=excluded.title,url=excluded.url,published_date=excluded.published_date,source_id=excluded.source_id,
    source_name=excluded.source_name,source_url=excluded.source_url,feed_url=excluded.feed_url,
    source_category=excluded.source_category,source_categories_json=excluded.source_categories_json,
    snippet_en=excluded.snippet_en,summary_ja=excluded.summary_ja,key_takeaway_ja=excluded.key_takeaway_ja,
    assets_json=excluded.assets_json,companies_json=excluded.companies_json,topics_json=excluded.topics_json,
    focal_related=excluded.focal_related,japan_relevant=excluded.japan_relevant,summary_model=excluded.summary_model,
    summary_generated_at_utc=excluded.summary_generated_at_utc,summary_status=excluded.summary_status,
    last_seen_at_utc=CASE WHEN excluded.last_seen_at_utc>industry_news.last_seen_at_utc THEN excluded.last_seen_at_utc ELSE industry_news.last_seen_at_utc END,
    article_sha256=excluded.article_sha256,synced_at_utc=excluded.synced_at_utc
    WHERE industry_news.article_sha256<>excluded.article_sha256 OR excluded.last_seen_at_utc>industry_news.last_seen_at_utc`;
  const statements = normalized.map(document => env.CHAT_DB.prepare(sql).bind(
    document.article_id, document.title, document.url, document.published_date, document.source_id, document.source_name,
    document.source_url, document.feed_url, document.source_category, document.source_categories_json, document.snippet_en,
    document.summary_ja, document.key_takeaway_ja, document.assets_json, document.companies_json, document.topics_json,
    document.focal_related, document.japan_relevant, document.summary_model, document.summary_generated_at_utc,
    document.summary_status, document.first_seen_at_utc, document.last_seen_at_utc, document.article_sha256, now
  ));
  const results = statements.length ? await env.CHAT_DB.batch(statements) : [];
  const mode = body?.mode === 'full' ? 'full' : 'delta';
  const countRow = await env.CHAT_DB.prepare('SELECT COUNT(*) AS count FROM industry_news').first();
  await env.CHAT_DB.prepare(
    `INSERT INTO industry_news_sync_state(source,source_generated_at_utc,source_document_count,archived_document_count,last_full_sync_at_utc,last_delta_sync_at_utc,updated_at_utc)
     VALUES('github-industry-news',?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET
     source_generated_at_utc=excluded.source_generated_at_utc,source_document_count=excluded.source_document_count,
     archived_document_count=excluded.archived_document_count,
     last_full_sync_at_utc=COALESCE(excluded.last_full_sync_at_utc,industry_news_sync_state.last_full_sync_at_utc),
     last_delta_sync_at_utc=excluded.last_delta_sync_at_utc,updated_at_utc=excluded.updated_at_utc`
  ).bind(String(body?.source_generated_at_utc || ''), Number(body?.source_document_count || 0), Number(countRow?.count || 0), mode === 'full' ? now : null, now, now).run();
  return {
    mode,
    received: normalized.length,
    upserted: results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0),
    archived_documents: Number(countRow?.count || 0),
    synced_at_utc: now
  };
}

async function reserveBudget(env, kind) {
  const date = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const isSummary = kind !== 'chat';
  const amount = kind === 'news-summary' ? RESERVE_NEURONS_PER_NEWS_SUMMARY : (isSummary ? RESERVE_NEURONS_PER_SUMMARY : RESERVE_NEURONS_PER_CHAT);
  const limit = Number(isSummary ? (env.SUMMARY_DAILY_NEURON_BUDGET || 4000) : (env.CHAT_DAILY_NEURON_BUDGET || 6000));
  const column = isSummary ? 'summary_reserved_neurons' : 'chat_reserved_neurons';
  const calls = isSummary ? 'summary_calls' : 'chat_calls';
  await env.CHAT_DB.prepare('INSERT OR IGNORE INTO ai_budget(date_utc,summary_reserved_neurons,chat_reserved_neurons,summary_calls,chat_calls,updated_at) VALUES(?,0,0,0,0,?)').bind(date, now).run();
  const result = await env.CHAT_DB.prepare(
    `UPDATE ai_budget SET ${column}=${column}+?, ${calls}=${calls}+1, updated_at=? ` +
    `WHERE date_utc=? AND ${column}+?<=? AND summary_reserved_neurons+chat_reserved_neurons+?<=10000`
  ).bind(amount, now, date, amount, limit, amount).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function saveMessage(env, owner, threadId, role, content, citations = []) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.CHAT_DB.prepare(
    'INSERT INTO messages(id,thread_id,owner_id,role,content,citations_json,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(id, threadId, owner, role, content, JSON.stringify(citations), now).run();
  await env.CHAT_DB.prepare('UPDATE threads SET updated_at=? WHERE id=? AND owner_id=?').bind(now, threadId, owner).run();
  return id;
}

async function ensureThread(env, owner, threadId, question) {
  const id = threadId || crypto.randomUUID();
  const now = new Date().toISOString();
  await env.CHAT_DB.prepare(
    'INSERT OR IGNORE INTO threads(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)'
  ).bind(id, owner, String(question).slice(0, 60), now, now).run();
  const row = await env.CHAT_DB.prepare('SELECT id FROM threads WHERE id=? AND owner_id=?').bind(id, owner).first();
  if (!row) throw new Error('Thread does not belong to this user');
  return id;
}

function clientKey(request) {
  return ownerId(request) || request.headers.get('CF-Connecting-IP') || 'unknown-client';
}

async function enforceRateLimit(durableNamespace, binding, request, routeName, maximum) {
  const key = `${clientKey(request)}:${routeName}`;
  if (durableNamespace) {
    const id = durableNamespace.idFromName(key);
    const stub = durableNamespace.get(id);
    const durableResponse = await stub.fetch('https://rate-limiter/check', {
      method: 'POST',
      body: JSON.stringify({ maximum, windowMs: 60 * 1000 })
    });
    const result = await durableResponse.json();
    if (!result.success) {
      const response = jsonResponse({ error: '利用回数が一時的な上限に達しました。1分後に再試行してください。' }, 429, request);
      response.headers.set('Retry-After', String(result.retryAfter || 60));
      return response;
    }
  }
  if (binding) {
    const { success } = await binding.limit({ key });
    if (!success) {
      const response = jsonResponse({ error: '利用回数が一時的な上限に達しました。1分後に再試行してください。' }, 429, request);
      response.headers.set('Retry-After', '60');
      return response;
    }
  }
  return null;
}

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    if (url.pathname === '/health') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-max-age': '86400'
      }});
    }
    if (!allowedOrigin(request)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (url.pathname === '/health') {
    let counts = null;
    let industryNews = null;
    try { counts = await evidenceCounts(env); } catch (error) { console.warn('Evidence health unavailable', error); }
    try { industryNews = await industryNewsCounts(env); } catch (error) { console.warn('Industry news health unavailable', error); }
    return jsonResponse({
      status: 'ok', model: MODEL, paid_fallback: false,
      ingest_configured: Boolean(env.INGEST_SECRET), access_gateway: Boolean(env.PAGE_GATEWAY_SECRET),
      rate_limited: Boolean(env.API_RATE_LIMITER || env.CHAT_RATE_LIMITER),
      corpus_source: counts?.searchable ? 'd1-evidence' : (env.NOTION_API_KEY && env.NOTION_DATABASE_ID ? 'notion' : 'validated-public-feed'),
      evidence: counts,
      industry_news: industryNews
    }, 200, request);
  }
  if (url.pathname === '/api/admin/evidence/state' && request.method === 'GET') {
    if (!ingestAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    return jsonResponse(await evidenceState(env), 200, request);
  }
  if (url.pathname === '/api/admin/evidence/sync' && request.method === 'POST') {
    if (!ingestAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    return jsonResponse(await syncEvidence(env, await request.json()), 200, request);
  }
  if (url.pathname === '/api/admin/industry-news/state' && request.method === 'GET') {
    if (!ingestAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    return jsonResponse(await industryNewsState(env), 200, request);
  }
  if (url.pathname === '/api/admin/industry-news/sync' && request.method === 'POST') {
    if (!ingestAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    return jsonResponse(await syncIndustryNews(env, await request.json()), 200, request);
  }
  const browserApi = url.pathname === '/api/chat' || url.pathname === '/api/search' || url.pathname === '/api/threads' || url.pathname.startsWith('/api/threads/');
  if (browserApi && !gatewayAuthorized(request, env)) {
    return jsonResponse({ error: 'Cloudflare Access authentication is required' }, 401, request);
  }
  if (url.pathname === '/api/search' && request.method === 'POST') {
    const limited = await enforceRateLimit(env.API_RATE_LIMITER, env.SEARCH_RATE_LIMITER, request, 'search', 30);
    if (limited) return limited;
    const { query, limit } = await request.json();
    const articles = await searchCorpus(env, query, Math.min(Number(limit) || 10, 20));
    return jsonResponse({ query, count: articles.length, articles }, 200, request);
  }
  if (url.pathname === '/api/admin/summarize' && request.method === 'POST') {
    if (!ingestAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    const requestKey = String(request.headers.get('idempotency-key') || '').slice(0, 200);
    if (!requestKey) return jsonResponse({ error: 'Idempotency-Key is required' }, 400, request);
    const existing = await env.CHAT_DB.prepare('SELECT state,response_json FROM ai_requests WHERE request_key=?').bind(requestKey).first();
    if (existing?.state === 'completed' && existing.response_json) {
      return jsonResponse(JSON.parse(existing.response_json), 200, request);
    }
    if (existing?.state === 'processing') return jsonResponse({ error: 'Request is already processing' }, 409, request);
    if (existing?.state === 'failed') return jsonResponse({ error: 'Request failed; it will be retried in the next UTC day' }, 409, request);
    const now = new Date().toISOString();
    await env.CHAT_DB.prepare('INSERT INTO ai_requests(request_key,kind,date_utc,state,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .bind(requestKey, 'summary', now.slice(0, 10), 'processing', now, now).run();
    if (!(await reserveBudget(env, 'summary'))) {
      await env.CHAT_DB.prepare("UPDATE ai_requests SET state='failed',updated_at=? WHERE request_key=?").bind(new Date().toISOString(), requestKey).run();
      return jsonResponse({ error: 'Daily free summary budget exhausted', budget_exhausted: true }, 429, request);
    }
    const article = await request.json();
    try {
      const result = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: 'Return valid JSON only. Do not use markdown.' },
          { role: 'user', content: buildSummaryPrompt(article) }
        ],
        response_format: { type: 'json_object' },
        reasoning_effort: 'low',
        temperature: 0.1,
        max_completion_tokens: 1800
      });
      const payload = {
        response: result.response || result.choices?.[0]?.message?.content || '',
        usage: result.usage || null,
        model: MODEL
      };
      if (!payload.response) throw new Error('Qwen returned no final response after reasoning');
      await env.CHAT_DB.prepare("UPDATE ai_requests SET state='completed',response_json=?,updated_at=? WHERE request_key=?")
        .bind(JSON.stringify(payload), new Date().toISOString(), requestKey).run();
      return jsonResponse(payload, 200, request);
    } catch (error) {
      await env.CHAT_DB.prepare("UPDATE ai_requests SET state='failed',updated_at=? WHERE request_key=?")
        .bind(new Date().toISOString(), requestKey).run();
      throw error;
    }
  }
  if (url.pathname === '/api/admin/summarize-news' && request.method === 'POST') {
    if (!ingestAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    const requestKey = String(request.headers.get('idempotency-key') || '').slice(0, 200);
    if (!requestKey) return jsonResponse({ error: 'Idempotency-Key is required' }, 400, request);
    const existing = await env.CHAT_DB.prepare('SELECT state,response_json FROM ai_requests WHERE request_key=?').bind(requestKey).first();
    if (existing?.state === 'completed' && existing.response_json) return jsonResponse(JSON.parse(existing.response_json), 200, request);
    if (existing?.state === 'processing') return jsonResponse({ error: 'Request is already processing' }, 409, request);
    if (existing?.state === 'failed') return jsonResponse({ error: 'Request failed; it will be retried in the next UTC day' }, 409, request);
    const now = new Date().toISOString();
    await env.CHAT_DB.prepare('INSERT INTO ai_requests(request_key,kind,date_utc,state,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .bind(requestKey, 'news-summary', now.slice(0, 10), 'processing', now, now).run();
    if (!(await reserveBudget(env, 'news-summary'))) {
      await env.CHAT_DB.prepare("UPDATE ai_requests SET state='failed',updated_at=? WHERE request_key=?").bind(new Date().toISOString(), requestKey).run();
      return jsonResponse({ error: 'Daily free summary budget exhausted', budget_exhausted: true }, 429, request);
    }
    const article = await request.json();
    try {
      const result = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: 'Return valid JSON only. Do not use markdown.' },
          { role: 'user', content: buildNewsSummaryPrompt(article) }
        ],
        response_format: { type: 'json_object' }, reasoning_effort: 'low', temperature: 0.1, max_completion_tokens: 650
      });
      const payload = { response: result.response || result.choices?.[0]?.message?.content || '', usage: result.usage || null, model: MODEL };
      if (!payload.response) throw new Error('Qwen returned no final response after reasoning');
      await env.CHAT_DB.prepare("UPDATE ai_requests SET state='completed',response_json=?,updated_at=? WHERE request_key=?")
        .bind(JSON.stringify(payload), new Date().toISOString(), requestKey).run();
      return jsonResponse(payload, 200, request);
    } catch (error) {
      await env.CHAT_DB.prepare("UPDATE ai_requests SET state='failed',updated_at=? WHERE request_key=?").bind(new Date().toISOString(), requestKey).run();
      throw error;
    }
  }
  if (url.pathname === '/api/threads' && request.method === 'GET') {
    const limited = await enforceRateLimit(env.API_RATE_LIMITER, env.HISTORY_RATE_LIMITER, request, 'history', 60);
    if (limited) return limited;
    const owner = ownerId(request);
    const result = await env.CHAT_DB.prepare('SELECT id,title,created_at,updated_at FROM threads WHERE owner_id=? ORDER BY updated_at DESC LIMIT 50').bind(owner).all();
    return jsonResponse({ threads: result.results || [] }, 200, request);
  }
  if (url.pathname.startsWith('/api/threads/') && request.method === 'GET') {
    const limited = await enforceRateLimit(env.API_RATE_LIMITER, env.HISTORY_RATE_LIMITER, request, 'history', 60);
    if (limited) return limited;
    const owner = ownerId(request);
    const threadId = url.pathname.split('/').pop();
    const result = await env.CHAT_DB.prepare('SELECT id,role,content,citations_json,created_at FROM messages WHERE thread_id=? AND owner_id=? ORDER BY created_at').bind(threadId, owner).all();
    return jsonResponse({ messages: (result.results || []).map(row => ({ ...row, citations: JSON.parse(row.citations_json || '[]') })) }, 200, request);
  }
  if (url.pathname === '/api/chat' && request.method === 'POST') {
    const limited = await enforceRateLimit(env.API_RATE_LIMITER, env.CHAT_RATE_LIMITER, request, 'chat', 10);
    if (limited) return limited;
    const body = await request.json();
    const question = String(body.question || '').trim();
    if (!question || question.length > 2000) return jsonResponse({ error: '質問は1〜2000文字で入力してください。' }, 400, request);
    const owner = ownerId(request);
    const articles = await searchCorpus(env, question, 8);
    const threadId = await ensureThread(env, owner, body.thread_id, question);
    await saveMessage(env, owner, threadId, 'user', question);
    if (!articles.length) {
      const answer = '関連する文献を確認できませんでした。製品名、治療工程、評価指標、試験名などを加えて検索してください。';
      await saveMessage(env, owner, threadId, 'assistant', answer);
      return jsonResponse({ thread_id: threadId, answer, citations: [], mode: 'search-only' }, 200, request);
    }
    if (!(await reserveBudget(env, 'chat'))) {
      const answer = '本日の無料AI枠に達したため、文献検索結果のみを表示します。生成回答はUTC日付の更新後に再開します。';
      await saveMessage(env, owner, threadId, 'assistant', answer, articles);
      return jsonResponse({ thread_id: threadId, answer, citations: articles, mode: 'search-only', budget_exhausted: true }, 200, request);
    }
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: '根拠にない情報を作らず、引用番号を付けて回答してください。' },
        { role: 'user', content: buildGroundedPrompt(question, articles) }
      ],
      reasoning_effort: 'low',
      temperature: 0.1,
      max_completion_tokens: 1400
    });
    const answer = String(result.response || result.choices?.[0]?.message?.content || '').trim() || '生成回答を取得できませんでした。';
    await saveMessage(env, owner, threadId, 'assistant', answer, articles);
    return jsonResponse({ thread_id: threadId, answer, citations: articles, mode: 'qwen' }, 200, request);
  }
  return jsonResponse({ error: 'Not found' }, 404, request);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: 'Internal server error', detail: env.ENVIRONMENT === 'development' ? String(error) : undefined }, 500, request);
    }
  }
};

export class ApiRateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const { maximum, windowMs } = await request.json();
    const now = Date.now();
    const result = await this.state.storage.transaction(async txn => {
      let bucket = await txn.get('bucket');
      if (!bucket || now >= bucket.resetAt) bucket = { count: 0, resetAt: now + windowMs };
      bucket.count += 1;
      await txn.put('bucket', bucket);
      return { success: bucket.count <= maximum, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    });
    return Response.json(result);
  }
}
