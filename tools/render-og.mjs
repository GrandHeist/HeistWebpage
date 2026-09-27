// Renders tools/og.html to public/og.png (1200x630) with headless Chromium.
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node tools/render-og.mjs
// Optional: CHROMIUM_PATH to point at a specific browser binary.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : 'playwright-core');

function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    for (const sub of readdirSync(join(base, d))) {
      const p = join(base, d, sub, 'Chromium.app/Contents/MacOS/Chromium');
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(here, 'og.html')).href);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(here, '..', 'public', 'og.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log('wrote public/og.png');
