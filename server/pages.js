// Small HTML pages for responses to plain form posts and for errors. Every string that ends up
// in these pages is fixed text written here; nothing the visitor sent is ever echoed back.
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function noticePage({ title, heading, message, tone = 'ok', back = { href: '/', label: 'Back to the site' } }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#07060a">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body class="page-notice">
<main class="notice notice--${tone}" id="main">
<p class="eyebrow"><a href="/">Heist Engine</a></p>
<h1>${escapeHtml(heading)}</h1>
<p class="notice__text">${escapeHtml(message)}</p>
<p><a class="btn btn--ghost" href="${escapeHtml(back.href)}">${escapeHtml(back.label)}</a></p>
</main>
</body>
</html>
`;
}

export const successPage = () =>
  noticePage({
    title: "You're on the list - Heist Engine",
    heading: "You're on the list.",
    message: "Thanks. We'll only use your email to tell you when Heist Engine is ready.",
  });

export const errorPage = (status, message) =>
  noticePage({
    title: `Something went wrong - Heist Engine`,
    heading: status === 404 ? 'Nothing here.' : 'That did not work.',
    message,
    tone: 'error',
    back: status === 404 ? { href: '/', label: 'Back to the site' } : { href: '/#early-access', label: 'Back to the form' },
  });
