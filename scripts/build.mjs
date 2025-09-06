#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const distDir = path.join(projectRoot, 'dist');
const htmlEntry = path.join(srcDir, 'index.html');

const MIME = new Map(Object.entries({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}));

const isHttp = (u) => /^https?:\/\//i.test(u);
const isData = (u) => /^data:/i.test(u);

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function toDataURL(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME.get(ext) || 'application/octet-stream';
  const buf = await readFile(filePath);
  // Base64 everything for simplicity and reliability
  const b64 = buf.toString('base64');
  return `data:${mime};base64,${b64}`;
}

function minifyCSS(input) {
  let css = input;
  css = css.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
  css = css.replace(/\s+/g, ' '); // collapse whitespace
  css = css.replace(/\s*([{}:;,>])\s+/g, '$1'); // trim around symbols
  css = css.replace(/;}/g, '}'); // drop last semicolons
  return css.trim();
}

async function inlineCSS(css, baseDir) {
  // Replace url(...) with inlined data URLs for local assets
  const urlRe = /url\(([^)]+)\)/g;
  const tasks = [];
  const replacements = [];
  let m;
  while ((m = urlRe.exec(css))) {
    const raw = m[1].trim().replace(/^['"]|['"]$/g, '');
    if (!raw || isHttp(raw) || isData(raw)) continue;
    const assetPath = path.resolve(baseDir, raw);
    tasks.push(toDataURL(assetPath));
    replacements.push({ start: m.index, end: m.index + m[0].length, raw, full: m[0] });
  }
  const dataUrls = await Promise.all(tasks);
  // Apply replacements from end to start to keep indexes valid
  let out = css;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const rep = replacements[i];
    const dataUrl = dataUrls[i];
    out = out.slice(0, rep.start) + `url(${dataUrl})` + out.slice(rep.end);
  }
  return out;
}

async function inlineHTML(html, baseDir) {
  // Inline <link rel="stylesheet" href="...">
  html = await replaceAsync(html, /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, async (_m, href) => {
    if (isHttp(href) || isData(href)) throw new Error(`External stylesheet not allowed: ${href}`);
    const cssPath = path.resolve(baseDir, href);
    let css = await readFile(cssPath, 'utf8');
    css = await inlineCSS(css, path.dirname(cssPath));
    css = minifyCSS(css);
    return `<style>${css}</style>`;
  });

  // Inline <script src="..."></script> while preserving other attributes (e.g., type="module").
  html = await replaceAsync(
    html,
    /<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    async (_m, pre, src, post) => {
      if (isHttp(src) || isData(src)) throw new Error(`External script not allowed: ${src}`);
      const jsPath = path.resolve(baseDir, src);
      const js = await readFile(jsPath, 'utf8');
      // Merge attributes and strip any src=...
      let attrs = `${pre || ''} ${post || ''}`.trim();
      attrs = attrs.replace(/\s*src=["'][^"']+["']/gi, '').replace(/\s{2,}/g, ' ').trim();
      const attrStr = attrs ? ' ' + attrs : '';
      return `<script${attrStr}>${js}</script>`;
    }
  );

  // Inline <img src="...">
  html = await replaceAsync(html, /<img([^>]*?)\s+src=["']([^"']+)["']([^>]*)>/gi, async (_m, pre, src, post) => {
    if (isHttp(src) || isData(src)) return _m; // leave as-is if already data/http
    const p = path.resolve(baseDir, src);
    const dataUrl = await toDataURL(p);
    return `<img${pre} src="${dataUrl}"${post}>`;
  });

  // Inline <link rel="icon" href="...">
  html = await replaceAsync(html, /<link([^>]*?rel=["']icon["'][^>]*?)href=["']([^"']+)["']([^>]*)>/gi, async (_m, pre, href, post) => {
    if (isHttp(href) || isData(href)) return _m;
    const p = path.resolve(baseDir, href);
    const dataUrl = await toDataURL(p);
    return `<link${pre}href="${dataUrl}"${post}>`;
  });

  return html;
}

async function replaceAsync(str, re, fn) {
  const parts = [];
  let lastIndex = 0;
  for (let m; (m = re.exec(str)); ) {
    parts.push(str.slice(lastIndex, m.index));
    parts.push(await fn(...m));
    lastIndex = m.index + m[0].length;
  }
  parts.push(str.slice(lastIndex));
  return parts.join('');
}

function validateNoExternals(html) {
  const problems = [];
  // Any script with src is external (we inline JS).
  if (/<script[^>]*\ssrc=/i.test(html)) problems.push('Found external <script src> tag');
  // Allow <link ... href="data:..."> (e.g., favicon). Disallow anything else.
  const badLink = /<link[^>]*\shref=["'](?!data:)[^"']+["'][^>]*>/i.test(html);
  if (badLink) problems.push('Found <link href> that is not a data: URL');
  // Disallow any http(s) references anywhere.
  if (/https?:\/\//i.test(html)) problems.push('Found http(s) URL reference');
  if (problems.length) {
    const msg = problems.join('\n');
    throw new Error(`Build produced external references:\n${msg}`);
  }
}

async function build() {
  const html = await readFile(htmlEntry, 'utf8');
  let inlined = await inlineHTML(html, path.dirname(htmlEntry));
  // Inject version from package.json for UI display
  const pkgPath = path.join(projectRoot, 'package.json');
  let version = '0.0.0-dev';
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    version = pkg.version || version;
  } catch {}
  const verScript = `<script>window.__APP_VERSION__=${JSON.stringify(version)};<\/script>`;
  if (/<\/head>/i.test(inlined)) {
    inlined = inlined.replace(/<\/head>/i, verScript + '\n  </head>');
  } else if (/<\/body>/i.test(inlined)) {
    inlined = inlined.replace(/<\/body>/i, verScript + '\n</body>');
  } else {
    inlined += verScript;
  }
  // Pre-fill visible version text as a fallback if JS is cached/disabled
  inlined = inlined.replace(/(<span[^>]*id=["']version["'][^>]*>)(<\/span>)/i, `$1v${version}$2`);
  validateNoExternals(inlined);
  await mkdir(distDir, { recursive: true });
  const out = path.join(distDir, 'SquareQuber.html');
  await writeFile(out, inlined, 'utf8');
  console.log(`Built: ${path.relative(projectRoot, out)}`);
}

build().catch((err) => {
  console.error('[build] Error:', err.message);
  process.exit(1);
});
