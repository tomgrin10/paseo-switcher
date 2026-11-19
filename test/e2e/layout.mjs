// Standalone fictional SDK fixture; runs the production DOM adapter without touching a daemon.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { chromium } from 'playwright-core';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test/artifacts/layout');
mkdirSync(out, { recursive: true });
const server = createServer((req, res) => {
  if (/^\/client\/[a-z-]+$/.test(req.url)) {
    let source = process.env.LAYOUT_BASELINE
      ? execFileSync('git', ['show', 'origin/main:' + req.url.slice(1) + '.ts'], {cwd:root, encoding:'utf8'})
      : readFileSync(resolve(root, '.' + req.url + '.ts'), 'utf8');
    source = source.replace(/from "(\.\/[a-z-]+)\.ts"/g, 'from "$1"');
    source = source.replace('import { Platform } from "react-native";', 'const Platform = { OS: "web" };');
    res.setHeader('Content-Type', 'text/javascript');
    res.end(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>Workspace switcher fixture</title><style>body{margin:0;background:#f6f6f7;font:14px system-ui;color:#63636b}main{padding:36px}h1{font-size:20px}</style><main><h1>acme</h1><p>Workspaces</p><p>Smart Session</p><p>Invoice exports</p></main><script type="module">
      import { installSwitcher } from '/client/switcher';
      const entries = ['Smart Session', 'Invoice exports'].map((name, i) => ({id: String(i), name, projectDisplayName:'acme', status:'done', gitRuntime:{currentBranch:'feat/workspace-search'}}));
      window.switcher = installSwitcher({workspaces:{list:async()=>({entries, subscription:{subscribe:()=>()=>{},release:async()=>{}}})}});
    </script>`);
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/h/dev-box/workspace/1`);
  await page.waitForFunction(() => window.switcher);
  async function open() { await page.evaluate(() => window.switcher.open()); await page.waitForSelector('.pws-root'); }
  async function type(text, physical = 'smart session', ctrl = false) {
    await page.evaluate(({ text, physical, ctrl }) => {
      [...text].forEach((key, i) => window.dispatchEvent(new KeyboardEvent('keydown', {key, code:physical[i] === ' ' ? 'Space' : 'Key' + physical[i].toUpperCase(), ctrlKey:ctrl, bubbles:true, cancelable:true})));
    }, {text,physical,ctrl});
  }
  await open();
  await type('سمرات سيسسيون');
  assert.match(await page.locator('.pws-name').innerText(), /Smart Session/);
  assert.match(await page.locator('.pws-layout-hint').innerText(), /smart session/);
  await page.keyboard.press('Escape');
  await type('דצשרא דקדדןםמ', 'smart session', true);
  assert.match(await page.locator('.pws-name').innerText(), /Smart Session/);
  assert.equal(await page.locator('.pws-mark').count(), 2);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.body.style.background = theme === 'dark' ? 'rgb(24,24,27)' : 'rgb(246,246,247)'; document.body.style.color = theme === 'dark' ? '#a1a1aa' : '#63636b'; }, theme);
    // Move triggers no redraw; reopen to sample the new host surface.
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await open();
    await type('דצשרא דקדדןםמ');
    await page.screenshot({ path: resolve(out, `${theme}.png`) });
    await page.evaluate(() => window.switcher.setLayout('strip'));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await open(); await type('דצשרא דקדדןםמ');
    await page.screenshot({ path: resolve(out, `${theme}-thumbnails.png`) });
    await page.evaluate(() => window.switcher.setLayout('list'));
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'דצשרא דקדדןםמ');
    window.dispatchEvent(new ClipboardEvent('paste', {clipboardData:data, bubbles:true, cancelable:true}));
  });
  assert.match(await page.locator('.pws-name').innerText(), /Smart Session/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'x', code:'KeyS', isComposing:true, bubbles:true}));
    window.dispatchEvent(new CompositionEvent('compositionend', {data:'ыьфке ыуыышщт', bubbles:true}));
  });
  assert.match(await page.locator('.pws-name').innerText(), /Smart Session/);
  await page.keyboard.press('Escape'); await page.keyboard.type('invoice');
  assert.equal(await page.locator('.pws-layout-hint').count(), 0);
  assert.match(await page.locator('.pws-name').innerText(), /Invoice exports/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pws-query').count(), 0);
  assert.equal(await page.locator('.pws-layout-hint').count(), 0);
  await page.evaluate(() => window.switcher.dispose());
  assert.equal(await page.locator('.pws-root').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: physical any-layout capture, Ctrl-held typing, table paste, IME, highlights, literal hint suppression, empty query, cleanup; four theme/layout PNGs');
} finally { await browser.close(); server.close(); }
