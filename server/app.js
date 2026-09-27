import { createServer } from 'node:http';
import { openSignups } from './db.js';
import { createRateLimiter } from './ratelimit.js';
import { clientAddress, rateKey } from './ip.js';
import { validateSignup } from './validate.js';
import { createStaticHandler } from './static.js';
import { errorPage, successPage } from './pages.js';

// No inline scripts or styles anywhere, so the policy can be this tight.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const OK_MESSAGE = "You're on the list. We'll only use your email to tell you when Heist Engine is ready.";
const ERROR_MESSAGES = {
  rate_limited: 'Too many attempts from your network. Please try again later.',
  too_large: 'That request was too large.',
  unsupported_type: 'Unsupported content type.',
  closed: 'Sign-ups are not being accepted right now. Please try again later.',
  server_error: 'Something went wrong on our side. Please try again later.',
  not_found: 'Not found.',
  method_not_allowed: 'Method not allowed.',
  bad_request: 'Bad request.',
};

const mediaType = (req) => (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

// Browsers posting the form ask for HTML; the page script and API clients get JSON.
function wantsJson(req) {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) return false;
  return accept.includes('application/json') || mediaType(req) === 'application/json';
}

// Reads the request body, refusing anything over `limit` bytes. Oversized bodies are drained
// (up to a hard cap) rather than cut off, so the client still receives the 413.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    let tooLarge = Number.isFinite(declared) && declared > limit;
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      if (size > limit * 16) return req.destroy();
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => (tooLarge ? reject(Object.assign(new Error('too_large'), { code: 'too_large' })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
    req.on('close', () => {
      if (!req.complete) reject(Object.assign(new Error('aborted'), { code: 'aborted' }));
    });
  });
}

function parseBody(type, raw) {
  const text = raw.toString('utf8');
  if (type === 'application/json') {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  const params = new URLSearchParams(text);
  const body = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    // The same field twice is never something the form does.
    if (values.length > 1) return undefined;
    body[key] = values[0];
  }
  return body;
}

export function createApp(config) {
  const db = openSignups({ dataDir: config.dataDir, ipSalt: config.ipSalt });
  const limiter = createRateLimiter(config.rateLimit);
  const serveStatic = createStaticHandler(config.publicDir);
  const log = config.log || (() => {});

  function send(req, res, status, { json, html, headers = {} }) {
    const useJson = wantsJson(req);
    const body = useJson ? JSON.stringify(json) : html;
    res.writeHead(status, {
      'Content-Type': useJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const sendError = (req, res, status, code, message = ERROR_MESSAGES[code], headers) =>
    send(req, res, status, {
      json: { ok: false, error: code, message },
      html: errorPage(status, message),
      headers,
    });

  const sendOk = (req, res) => send(req, res, 200, { json: { ok: true, message: OK_MESSAGE }, html: successPage() });

  async function signup(req, res) {
    if (req.method !== 'POST') return sendError(req, res, 405, 'method_not_allowed', undefined, { Allow: 'POST' });

    const verdict = limiter.hit(rateKey(clientAddress(req, config.trustProxy)));
    if (!verdict.allowed) {
      req.resume();
      return sendError(req, res, 429, 'rate_limited', undefined, { 'Retry-After': String(verdict.retryAfterSec) });
    }

    const type = mediaType(req);
    if (type !== 'application/json' && type !== 'application/x-www-form-urlencoded') {
      req.resume();
      return sendError(req, res, 415, 'unsupported_type');
    }

    let raw;
    try {
      raw = await readBody(req, config.maxBodyBytes);
    } catch (err) {
      if (err.code === 'too_large') return sendError(req, res, 413, 'too_large', undefined, { Connection: 'close' });
      return; // the client went away
    }

    const body = parseBody(type, raw);
    if (body === undefined) return sendError(req, res, 400, 'invalid_body', 'That request could not be read.');

    const result = validateSignup(body);
    if (!result.ok) return sendError(req, res, 400, result.error, result.message);
    if (result.bot) return sendOk(req, res); // pretend it worked, store nothing

    // Existing and new emails get the same answer, so the form cannot be used to check who signed up.
    if (db.count() >= config.maxSignups) return sendError(req, res, 503, 'closed');
    db.add({ ...result.value, ip: clientAddress(req, config.trustProxy) });
    return sendOk(req, res);
  }

  function health(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(req, res, 405, 'method_not_allowed', undefined, { Allow: 'GET, HEAD' });
    }
    db.count(); // throws (and becomes a 500) if the database is unusable
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : '{"ok":true}');
  }

  // Sets req.routeLabel (used for the log line) before it responds.
  async function route(req, res) {
    const target = req.url || '/';
    if (!target.startsWith('/')) {
      req.routeLabel = 'bad-request';
      return sendError(req, res, 400, 'bad_request');
    }
    const pathname = target.split(/[?#]/)[0];

    if (pathname === '/api/signup') {
      req.routeLabel = 'api/signup';
      return signup(req, res);
    }
    if (pathname === '/api/health') {
      req.routeLabel = 'api/health';
      return health(req, res);
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      req.routeLabel = 'api/other';
      return sendError(req, res, 404, 'not_found');
    }

    req.routeLabel = 'static';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(req, res, 405, 'method_not_allowed', undefined, { Allow: 'GET, HEAD' });
    }
    const served = await serveStatic(req, res, pathname);
    if (served.status === 404 || served.status === 400) {
      req.routeLabel = served.status === 404 ? 'not-found' : 'bad-request';
      const html = errorPage(served.status, served.status === 404 ? ERROR_MESSAGES.not_found : ERROR_MESSAGES.bad_request);
      res.writeHead(served.status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
    }
  }

  const server = createServer(async (req, res) => {
    const started = performance.now();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    res.on('finish', () => {
      // Route label only: no query strings, no client addresses, nothing a visitor typed.
      log(`${new Date().toISOString()} ${req.method} ${req.routeLabel || '-'} ${res.statusCode} ${Math.round(performance.now() - started)}ms`);
    });
    try {
      await route(req, res);
    } catch (err) {
      req.routeLabel = 'error';
      log(`${new Date().toISOString()} error ${err.code || err.name}`);
      if (!res.headersSent) {
        try {
          sendError(req, res, 500, 'server_error');
        } catch {
          res.destroy();
        }
      } else {
        res.destroy();
      }
    }
  });
  // Slow-client protection.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  return {
    server,
    db,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      }),
    close: () =>
      new Promise((resolve) => {
        limiter.stop();
        server.closeAllConnections?.();
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
