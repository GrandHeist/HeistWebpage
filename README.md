# heist-site

The coming-soon site for [Heist Engine](https://x.com/GTAHeistEngine): a one-page site with an early-access signup, plus the small server that hosts it and stores the signups.

Heist Engine is an economy engine for GTA RP servers (FiveM / RageMP). Every economic action in the world becomes a typed transfer on a tamper-evident ledger. It is in development; this site says so and lets people register their interest.

There is nothing to install: no dependencies, no build step. It needs **Node 24 or newer** (it uses the built-in `node:sqlite`).

## Run it

```sh
npm start            # http://127.0.0.1:3901
npm test             # the test suite (node:test, no dependencies)
npm run export       # print all signups as CSV on stdout
```

Settings come from environment variables (or a `.env` file in the project root; see `.env.example`):

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3901` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to bind. Set `0.0.0.0` to accept outside connections |
| `DATA_DIR` | `./data` | Where `signups.sqlite` and the IP salt live |
| `IP_SALT` | generated | Secret for hashing IP addresses. If unset, a random one is created once in `DATA_DIR/ip-salt` |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the server. Only set it if a proxy you control sets `X-Forwarded-For`; otherwise the rate limiter would trust a header anyone can forge |

## What is in here

```
public/          the site: index.html, privacy.html, styles.css, app.js, favicon.svg, og.png
server/          the Node server (http, sqlite, validation, rate limit, csv export)
tests/           node:test suites
tools/           og.html + render-og.mjs, which produce public/og.png
```

The site is static HTML, one stylesheet and one small script. It makes no requests to other sites: no CDN, no web fonts, no analytics. Fonts are the visitor's system fonts. The server sends a strict Content-Security-Policy (no inline scripts or styles), which the page is built to satisfy.

## How signups work

The form posts to `POST /api/signup`.

- **With JavaScript** the form is sent as JSON in the background and the result shows inline (`aria-live`, button disabled while sending).
- **Without JavaScript** it is a normal form post, and the server answers with a small HTML page ("You're on the list" or a plain error page with a link back).

Fields: `email` (required), `role` (`server_owner`, `developer`, `player`, optional), `server` (optional, up to 100 characters), and a hidden `homepage` honeypot.

What the server does with a request:

- Rate limit: 10 attempts per hour per client address (IPv6 clients are grouped by /64). More gets `429` with `Retry-After`. The limiter lives in memory, so a restart resets it.
- Body limit 4 KB (`413`), and only `application/json` or `application/x-www-form-urlencoded` (`415`).
- Email: trimmed, lower-cased, strictly validated (ASCII local part, real-looking domain, max 254 characters; internationalised domains are stored as punycode). Server name: Unicode-normalised, control and invisible characters removed, whitespace collapsed.
- A filled honeypot gets the normal success answer and nothing is stored.
- A duplicate email gets the same success answer as a new one and does not change the existing row, so the form cannot be used to check who has signed up.
- All SQL is parameterised. No email addresses, server names or client addresses are written to logs (the log only has the method, a route label and the status).
- No CORS headers. The signups database is capped at 50,000 rows as a backstop against floods.

Storage is `data/signups.sqlite` (created on first run, git-ignored, owner-only permissions):

| column | notes |
|---|---|
| `id` | integer primary key |
| `email` | unique |
| `role` | one of the three roles, or null |
| `server` | free text, or null |
| `created_at` | ISO 8601 UTC |
| `ip_hash` | HMAC-SHA-256 of the client address with a secret salt, truncated. The address itself is never stored |

`npm run export` prints `id, email, role, server, created_at` as CSV (no IP hash). There is deliberately no HTTP endpoint for it: run it on the machine that holds the data. Any cell that starts with `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe so a spreadsheet does not run it as a formula. That includes real addresses such as `+name@example.com`.

To remove someone, delete their row: `sqlite3 data/signups.sqlite "DELETE FROM signups WHERE email = 'them@example.com'"`.

## Other routes

- `GET /api/health` returns `{"ok":true}` if the database is usable.
- Pages are served from `public/`. `/privacy` maps to `privacy.html`. Dotfiles, path traversal and symlinks that leave `public/` are refused.

## Regenerating the share image

`public/og.png` (1200x630) is rendered from `tools/og.html` with headless Chromium:

```sh
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.mjs node tools/render-og.mjs
```

The page's Open Graph tags point at `https://heistengine.com/og.png`, so the image only shows up in link previews once the site is live on that domain.

## Deploying

See [DEPLOY.md](DEPLOY.md). Nothing is deployed yet.
