const DEFAULT_WORKER_BASE = 'https://align-clinical-radar-api.sh-radar.workers.dev';

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const isAllowedPath = url.pathname === '/api/health' ||
    url.pathname === '/api/chat' ||
    url.pathname === '/api/search' ||
    url.pathname === '/api/threads' ||
    url.pathname.startsWith('/api/threads/');
  if (!isAllowedPath) return json({ error: 'Not found' }, 404);

  const owner = String(context.request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
  if (!owner) return json({ error: 'Cloudflare Access authentication is required' }, 401);
  if (!context.env.PAGE_GATEWAY_SECRET) return json({ error: 'Access gateway is not configured' }, 503);

  const targetPath = url.pathname === '/api/health' ? '/health' : url.pathname;
  const workerBase = String(context.env.ALIGN_RADAR_WORKER_BASE || DEFAULT_WORKER_BASE).replace(/\/$/, '');
  const target = new URL(`${workerBase}${targetPath}${url.search}`);
  const headers = new Headers();
  const contentType = context.request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('X-Page-Gateway-Secret', context.env.PAGE_GATEWAY_SECRET);
  headers.set('X-Authenticated-Owner', owner);

  const response = await fetch(target, {
    method: context.request.method,
    headers,
    body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(response.headers.get('retry-after') ? { 'retry-after': response.headers.get('retry-after') } : {})
    }
  });
}
