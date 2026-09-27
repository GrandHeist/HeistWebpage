import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

export const contentTypeFor = (file) => TYPES[extname(file).toLowerCase()] || 'application/octet-stream';

// Maps a request path onto a file inside `root`, or returns { status } for a request to refuse.
// Nothing outside root is reachable: dot segments, encoded slashes, backslashes, NUL bytes,
// dotfiles and symlinks that point out of the folder are all refused.
export async function resolveStatic(root, realRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };

  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return { status: 404 };

  // /privacy can be privacy.html, and a folder serves its index.html.
  const base = join(root, ...segments);
  const candidates = segments.length ? [base, `${base}.html`, join(base, 'index.html')] : [join(root, 'index.html')];

  for (const candidate of candidates) {
    if (!candidate.startsWith(root + sep)) return { status: 404 };
    let info;
    try {
      info = await stat(candidate);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    const real = await realpath(candidate);
    if (!real.startsWith(realRoot + sep)) return { status: 404 };
    return { file: real, info };
  }
  return { status: 404 };
}

export function createStaticHandler(root) {
  let realRootPromise;
  const getRealRoot = () => (realRootPromise ??= realpath(root));

  // Returns { status } for anything it will not serve, otherwise writes the file to `res` and returns { status: 200 | 304 }.
  return async function serve(req, res, pathname) {
    const realRoot = await getRealRoot();
    const found = await resolveStatic(realRoot, realRoot, pathname);
    if (!found.file) return { status: found.status };

    const etag = `W/"${found.info.size.toString(16)}-${Math.floor(found.info.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': contentTypeFor(found.file),
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return { status: 304 };
    }
    const body = await readFile(found.file);
    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return { status: 200 };
  };
}
