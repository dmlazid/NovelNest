import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Regression: the clean-route interceptor used to swallow clicks inside
// navigation dialogs before the dialog itself could close.
const source = fs.readFileSync(new URL('../dist/clean-routes.js', import.meta.url), 'utf8');

function simulateClick(inDrawer) {
  let click, routed = 0, prevented = false, stopped = false;
  const doc = {
    readyState: 'loading',
    addEventListener(type, handler) { if (type === 'click') click = handler; },
    querySelectorAll() { return []; },
  };
  const loc = { href: 'https://novelhaven.top/', origin: 'https://novelhaven.top',
    pathname: '/', search: '', hash: '' };
  const history = {
    replaceState() {},
    pushState() {},
  };
  const win = {
    addEventListener() {},
    NovelNestApp: { refresh() { routed++; } },
  };
  vm.runInNewContext(source, { document: doc, window: win,
    location: loc, history, URL, queueMicrotask });
  assert.equal(typeof click, 'function', 'Expected a document-level route handler');
  const anchor = {
    target: '',
    getAttribute(name) { return name === 'href' ? '/library' : null; },
    closest(selector) { return selector === '.site-drawer' && inDrawer ? {} : null; },
  };
  const event = {
    target: { closest(selector) { return selector === 'a[href]' ? anchor : null; } },
    button: 0,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; },
  };
  click(event);
  return { routed, prevented, stopped };
}

test('menu links reach their own dialog close handler', () => {
  assert.deepEqual(simulateClick(true), { routed: 0, prevented: false, stopped: false });
});

test('regular links are still handled by the clean-route router', () => {
  assert.deepEqual(simulateClick(false), { routed: 1, prevented: true, stopped: true });
});

test('all mobile menu URLs remain same-origin paths, not //hostnames', () => {
  const accounts = fs.readFileSync(new URL('../dist/accounts.js', import.meta.url), 'utf8');
  const begin = accounts.indexOf('  function menuHref(href) {');
  const end = accounts.indexOf('  function drawerTop(', begin);
  assert(begin >= 0 && end > begin, 'Expected menu URL mapper');
  const menuHref = vm.runInNewContext('(' + accounts.slice(begin, end).trim() + ')');
  const host = 'https://novelhaven.top';
  for (const route of [
    '/library', '/library?tab=history', '/finder', '/genre/Action',
    '/latest-novels', '/latest-releases', '/completed', '/latest',
    '/latest-novels?sort=chapters', '/about'
  ]) {
    const result = menuHref('./#' + route);
    assert.equal(result, route, 'Unexpected menu URL for ' + route);
    assert(!result.startsWith('//'), 'Protocol-relative menu URL: ' + result);
    const resolved = new URL(result, host);
    assert.equal(resolved.origin, host, 'Menu URL escapes NovelHaven: ' + result);
  }
  assert.doesNotMatch(accounts, /menuRoute=/);
});


test('mobile menu uses same-document navigation and never forces a page reload', () => {
  const accounts = fs.readFileSync(new URL('../dist/accounts.js', import.meta.url), 'utf8');
  const start = accounts.indexOf("if (id === 'navigation-drawer') {");
  const end = accounts.indexOf("element.addEventListener('click', event => { if (event.target === element)", start);
  assert(start >= 0 && end > start, 'Expected mobile navigation handler');
  const handler = accounts.slice(start, end);
  assert.match(handler, /window\.NovelNestApp\?\.navigate/);
  assert.match(handler, /element\.close\(\)/);
  assert.doesNotMatch(handler, /window\.location\.assign\(destination\);/,
    'Mobile menu must not perform unconditional document navigation');
  assert.match(accounts, /window\.NovelNestApp\?\.navigate\(destination\)/,
    'Menu search must use the same in-page router');
});
