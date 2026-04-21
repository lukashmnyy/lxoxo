// ============================================================================
// L,XOXO Emote Checker — Cloudflare Worker proxy
// ----------------------------------------------------------------------------
// Responsibilities:
//   * Receive requests from emotechecker/index.html
//   * Forward them to Roblox (with .ROBLOSECURITY auth where needed)
//   * Return the raw response bytes to the browser with CORS headers
//
// Secrets (set via Cloudflare dashboard → Worker → Settings → Variables → "+ Add variable" → mark as Secret):
//   ROBLOX_COOKIE        — your .ROBLOSECURITY value (without the "_|WARNING..." prefix)
//   ALLOWED_ORIGIN       — e.g. "https://l-xoxo.com" (comma-separate multiple, or "*" to allow any)
//
// Endpoints this worker exposes:
//   GET  /asset?id=123            → binary bytes of the asset (auth-gated)
//   GET  /economy/v2/assets/{id}  → economy JSON (name, creator, created, price)
//   GET  /thumbnails?assetIds=... → thumbnail JSON { data: [{imageUrl}] }
//   GET  /favorites/{id}          → { count: number }
//   GET  /health                  → { ok: true, hasCookie: boolean }
// ============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = buildCORS(origin, env.ALLOWED_ORIGIN || '*');

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const path = url.pathname.replace(/\/+$/, '');

      // --- Health check -------------------------------------------------
      if (path === '' || path === '/' || path === '/health') {
        return json({ ok: true, hasCookie: !!env.ROBLOX_COOKIE }, corsHeaders);
      }

      // --- Asset delivery (authenticated) --------------------------------
      if (path === '/asset') {
        const id = url.searchParams.get('id');
        if (!id || !/^\d+$/.test(id)) return json({ error: 'missing or invalid id' }, corsHeaders, 400);
        return await fetchAsset(id, env, corsHeaders);
      }

      // --- Economy / asset details ---------------------------------------
      if (path.startsWith('/economy/')) {
        const sub = path.slice('/economy/'.length);
        return await passthrough(`https://economy.roblox.com/${sub}${url.search}`, env, corsHeaders, {
          withAuth: true,
          defaultContentType: 'application/json',
        });
      }

      // --- Catalog (favorites, etc.) -------------------------------------
      if (path === '/favorites') {
        const id = url.searchParams.get('id');
        if (!id || !/^\d+$/.test(id)) return json({ error: 'missing or invalid id' }, corsHeaders, 400);
        return await passthrough(`https://catalog.roblox.com/v1/favorites/assets/${id}/count`, env, corsHeaders, {
          withAuth: false,
          defaultContentType: 'application/json',
        });
      }

      // --- Thumbnails -----------------------------------------------------
      if (path === '/thumbnails') {
        const ids = url.searchParams.get('assetIds');
        const size = url.searchParams.get('size') || '150x150';
        if (!ids) return json({ error: 'missing assetIds' }, corsHeaders, 400);
        const target = `https://thumbnails.roblox.com/v1/assets?assetIds=${encodeURIComponent(ids)}&size=${encodeURIComponent(size)}&format=Png&isCircular=false`;
        return await passthrough(target, env, corsHeaders, { withAuth: false, defaultContentType: 'application/json' });
      }

      return json({ error: 'unknown route', path }, corsHeaders, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, corsHeaders, 500);
    }
  }
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildCORS(origin, allowed) {
  const list = String(allowed || '*').split(',').map(s => s.trim()).filter(Boolean);
  const allowAny = list.includes('*');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowAny) headers['Access-Control-Allow-Origin'] = '*';
  else if (list.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  else headers['Access-Control-Allow-Origin'] = list[0] || '';
  return headers;
}

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

function authHeaders(env) {
  const h = {
    'User-Agent': 'LXOXO-EmoteChecker/1.0 (+https://l-xoxo.com)',
    'Accept': '*/*',
  };
  if (env.ROBLOX_COOKIE) {
    // .ROBLOSECURITY cookies start with a bracketed warning block; both forms work
    const cookie = env.ROBLOX_COOKIE.startsWith('_|')
      ? env.ROBLOX_COOKIE
      : env.ROBLOX_COOKIE;
    h['Cookie'] = `.ROBLOSECURITY=${cookie}`;
  }
  return h;
}

async function passthrough(targetUrl, env, cors, opts = {}) {
  const init = {
    method: 'GET',
    headers: opts.withAuth ? authHeaders(env) : { 'User-Agent': 'LXOXO-EmoteChecker/1.0' },
    redirect: 'follow',
  };
  const r = await fetch(targetUrl, init);
  const body = await r.arrayBuffer();
  const headers = new Headers(cors);
  const ct = r.headers.get('Content-Type') || opts.defaultContentType || 'application/octet-stream';
  headers.set('Content-Type', ct);
  headers.set('X-Proxied-Status', String(r.status));
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(body, { status: r.status, headers });
}

// Roblox asset delivery: first hit the v1 endpoint which 302s to an rbxcdn
// signed URL. We follow the redirect manually so we can strip auth on the
// CDN hop (and so errors come back as JSON-ish responses we can surface).
async function fetchAsset(id, env, cors) {
  // Step 1: ask assetdelivery where the bytes live
  const meta = await fetch(`https://assetdelivery.roblox.com/v2/assetId/${id}`, {
    headers: authHeaders(env),
    redirect: 'manual',
  });

  // If Roblox responded with JSON containing a location, follow it unauthenticated
  const ct = meta.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    const j = await meta.json();
    if (j && Array.isArray(j.locations) && j.locations[0] && j.locations[0].location) {
      const loc = j.locations[0].location;
      const asset = await fetch(loc, { redirect: 'follow' });
      const bytes = await asset.arrayBuffer();
      const headers = new Headers(cors);
      headers.set('Content-Type', asset.headers.get('Content-Type') || 'application/octet-stream');
      headers.set('X-Asset-Id', String(id));
      headers.set('X-Asset-Type', String(j.assetTypeId || ''));
      headers.set('Cache-Control', 'public, max-age=3600');
      return new Response(bytes, { status: asset.status, headers });
    }
    // Authenticated error (e.g. still 401): surface it
    return json({ error: 'asset-delivery-failed', detail: j }, cors, meta.status || 502);
  }

  // Fallback: v1 endpoint which returns bytes directly with a redirect
  const direct = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${id}`, {
    headers: authHeaders(env),
    redirect: 'follow',
  });
  const bytes = await direct.arrayBuffer();
  const headers = new Headers(cors);
  headers.set('Content-Type', direct.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('X-Asset-Id', String(id));
  headers.set('X-Fallback', 'v1');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(bytes, { status: direct.status, headers });
}
