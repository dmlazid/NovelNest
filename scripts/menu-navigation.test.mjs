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

test('menu destinations use normal page paths instead of a home-page query', () => {
  const accounts = fs.readFileSync(new URL('../dist/accounts.js', import.meta.url), 'utf8');
  assert.match(accounts, /return '\/' \+ route;/);
  assert.doesNotMatch(accounts, /menuRoute=/);
});
