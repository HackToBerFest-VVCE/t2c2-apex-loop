// Tiny request/response layer shared by the Vercel functions (api/*.js) and the Vite dev server,
// so every endpoint is written once as: handler({ method, query, headers, body, cookies, origin }) → reply.
//
// A reply is { status, json?, redirect?, cookies?: string[] } — cookies are ready-made Set-Cookie values.

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readJson(req) {
  // Vercel pre-parses JSON bodies into req.body; the Vite dev server leaves the stream unread.
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || 'null') : req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

/** The site's own origin, e.g. https://civiclens-rouge.vercel.app or http://localhost:5173. */
function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${String(proto).split(',')[0]}://${host}`;
}

/** Wraps a handler as a Node (req, res) function, usable by Vercel and Vite alike. */
export function toNode(handler) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://local');
    let body = null;
    if (req.method === 'POST') {
      try {
        body = await readJson(req);
      } catch {
        body = null;
      }
    }
    let reply;
    try {
      reply = await handler({
        method: req.method,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
        cookies: parseCookies(req.headers.cookie),
        origin: originOf(req),
      });
    } catch (err) {
      console.error('[api] unhandled error', err);
      reply = { status: 500, json: { error: 'Something went wrong on the server.' } };
    }
    if (reply.cookies?.length) res.setHeader('Set-Cookie', reply.cookies);
    res.setHeader('Cache-Control', 'no-store');
    if (reply.redirect) {
      res.statusCode = 302;
      res.setHeader('Location', reply.redirect);
      res.end();
      return;
    }
    res.statusCode = reply.status ?? 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply.json ?? {}));
  };
}

/** Builds a Set-Cookie value. HttpOnly + Secure + SameSite=Lax by default. */
export function cookie(name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'Secure', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export const clearCookie = (name) => cookie(name, '', { maxAge: 0 });
