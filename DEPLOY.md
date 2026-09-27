# Putting heistengine.com live

Nothing here is set up yet: no hosting, no DNS changes, no accounts. This lists the realistic options and what each costs you. All of them keep the same code; only where it runs changes.

What the site needs at runtime: serve `public/` over HTTPS, accept `POST /api/signup`, and store rows somewhere you can read them later.

## Option A: a small VPS or a container host running this Node server

Run `npm start` behind HTTPS on a small machine (a VPS, or a container platform such as Fly.io or Railway with a persistent volume).

- **Pros:** the code works as it is, including the SQLite file, the rate limiter and `npm run export`. Cheapest in effort. One place holds everything.
- **Cons:** you look after a server (updates, restarts, backups). The database is a file, so the host must give you a **persistent disk** (a container without a volume loses signups on every deploy). One instance only: the rate limiter is in memory and SQLite is a single-writer file.
- **Set up:**
  - Node 24+; run as a normal user under a process manager (systemd, or the platform's own).
  - Put a reverse proxy (Caddy or nginx) in front for HTTPS, and set `HOST=127.0.0.1`, `TRUST_PROXY=1` so the rate limiter sees real client addresses. Make sure the proxy overwrites `X-Forwarded-For` rather than passing along a client's.
  - Set `DATA_DIR` to the persistent disk, and `IP_SALT` from the host's secret store.
  - Have the proxy add `Strict-Transport-Security` once HTTPS works (the Node server does not, because it does not know whether it is behind TLS).
  - Back up `signups.sqlite` (a nightly copy with `sqlite3 signups.sqlite ".backup backup.sqlite"` is enough).

## Option B: static host plus a serverless function plus a small database

Host `public/` on a static host (Cloudflare Pages, Netlify, Vercel, GitHub Pages) and rewrite `POST /api/signup` as a function that writes to a hosted database.

- **Pros:** no server to run, free or near-free tiers, automatic HTTPS and CDN.
- **Cons:** this repo's server does not run there, so the function is **new code**: the validation in `server/validate.js` can be reused as is (it has no dependencies), but storage moves from SQLite to whatever database you pick (a hosted Postgres, D1, a key-value store). Rate limiting needs the platform's own feature or a shared store, because in-memory counters do not survive across function invocations. The security headers, including the Content-Security-Policy in `server/app.js`, have to be configured in the host's headers file. Signup data then lives with a third-party provider (say so in the privacy page). Account creation and billing settings are on you.
- **GitHub Pages** alone cannot do this (no functions), so it would need an external form endpoint.

## Option C: static site plus a hosted form service

Serve `public/` statically and point the form at a form-handling service.

- **Pros:** least code to maintain.
- **Cons:** you lose control of the data and validation, the form must be changed to post to another origin (which the Content-Security-Policy `form-action` and `connect-src` rules would need to allow), and the honest privacy note has to name the provider.

## Recommendation

For a coming-soon page with a modest signup list, Option A on a small VPS or a Fly.io/Railway app with a volume is the least work and the least new code. Option B is better if you want no server at all and are happy to write a small function.

## DNS

The registrar is wherever you bought heistengine.com.

1. Pick the host first; it tells you the records.
2. VPS: an `A` record (and `AAAA` if it has IPv6) for `@` pointing at the server's IP. Static hosts and container platforms usually give a hostname for a `CNAME` (or an `ALIAS`/`ANAME` at the apex, since a plain `CNAME` is not allowed on the bare domain) plus a verification `TXT` record.
3. Decide on `www`: add a `CNAME` for `www` and redirect it to the bare domain (or the reverse), so there is one canonical address. The page's canonical link and Open Graph tags assume `https://heistengine.com/`.
4. Wait for the certificate to be issued (automatic on Caddy and on most hosts) and check `https://heistengine.com/`, `/api/health` and `/og.png`.
5. Lower the TTL before you switch, if the domain already has records you might need to roll back.
6. If you send email from the domain later, set up SPF/DKIM/DMARC before the first message goes out.

## Before you announce: data-protection checklist

You will be holding people's email addresses, so:

- [ ] **Privacy page is accurate.** `public/privacy.html` describes what the form stores today. Re-read it against the host you choose (for Option B or C it must name the provider that holds the data) and against your own contact details.
- [ ] **Name a contact for removal requests** and check it is watched. The site currently says to message @GTAHeistEngine on X. If you prefer an email address, change `public/privacy.html` and the note under the form in `public/index.html`.
- [ ] **A way to delete people.** Done by hand: see the delete command in the README. Do it promptly when asked and keep no copies (including old exports and backups older than you need).
- [ ] **Only use the list for what the page says**: telling people when Heist Engine is ready. If you want to send anything else, ask them first.
- [ ] **Delete the list when it has done its job**, or after a period you decide, rather than keeping it forever.
- [ ] **Keep exports safe.** CSV files contain email addresses: keep them off shared drives and out of the repository (`*.csv` is not git-ignored, so store exports outside the project or add a rule).
- [ ] **Protect the data at rest.** The data folder is owner-only by default; keep it that way, and encrypt backups.
- [ ] **Check whether local rules need more.** Depending on where you and your visitors are (the UK/EU GDPR, for example), you may need a named controller, a stated legal basis, and a retention period on the privacy page. Have someone who knows check before you collect at scale.
- [ ] **Turn on HTTPS only**, redirect HTTP, and add HSTS at the proxy or host.
- [ ] **Confirm the security headers reach visitors** (`curl -I https://heistengine.com/` should show the Content-Security-Policy, `X-Content-Type-Options` and the rest).
- [ ] **Confirm the rate limiter sees real client addresses** behind your proxy (`TRUST_PROXY`), otherwise everyone shares one allowance.
- [ ] **Keep the disclaimer** about Rockstar Games and Take-Two Interactive in the footer.
