import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('dist/affiliate-offers.js', 'utf8');
const homepage = fs.readFileSync('dist/index.html', 'utf8');

function run(offers) {
  const cards = [];
  const handlers = {};
  let target = null;
  const main = {
    querySelector(selector) {
      if (selector === '[data-affiliate-offer]') return cards[0] || null;
      if (selector === '.reader-wrap .end-note') return target;
      return null;
    },
  };
  target = {
    insertAdjacentElement(where, element) {
      assert.equal(where, 'afterend');
      cards.push(element);
    },
  };
  const document = {
    readyState: 'complete',
    querySelector(selector) { return selector === '#main' ? main : null; },
    createElement(tag) {
      return {
        tag,
        children: [],
        setAttribute(name, value) { this[name] = value; },
        append(...items) { this.children.push(...items); },
      };
    },
  };
  const window = {
    addEventListener(event, fn) { handlers[event] = fn; },
  };
  const location = { origin: 'https://novelhaven.top', pathname: '/novel/sample/chapter-1/' };
  const modified = source.replace('const OFFERS = [];', 'const OFFERS = ' + JSON.stringify(offers) + ';');
  assert(modified.includes('const OFFERS = ' + JSON.stringify(offers) + ';'), 'Offer configuration was not applied');
  vm.runInNewContext(modified, { document, window, location, URL });
  return { cards, handlers };
}

test('no affiliate URL means nothing visible and no automatic redirects', () => {
  const { cards, handlers } = run([]);
  assert.equal(cards.length, 0);
  handlers['novelnest:route-rendered']();
  assert.equal(cards.length, 0);
  assert.doesNotMatch(source, /location\.(?:assign|replace|href\s*=)|window\.open\s*\(/);
});

test('safe voluntary outbound link contains visible disclosure and sponsored rel', () => {
  const { cards, handlers } = run([{
    title: 'Reading accessories', description: 'Optional items',
    partner: 'Example Store', url: 'https://example.com/affiliate?ref=demo',
  }]);
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.tag, 'aside');
  assert.equal(card['data-affiliate-offer'], '');
  const link = card.children.find(x => x.tag === 'a' && x.href.startsWith('https://'));
  assert.equal(link.href, 'https://example.com/affiliate?ref=demo');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'sponsored noopener noreferrer');
  assert(card.children.some(x => x.textContent?.includes('commission')));
  assert(card.children.some(x => x.href === '/advertising-disclosure.html'));
  handlers['novelnest:route-rendered']();
  assert.equal(cards.length, 1, 'duplicate promotion must not be added');
});

test('invalid and unsafe affiliate destinations are ignored', () => {
  for (const url of ['javascript:alert(1)', 'http://example.com/', 'https://novelhaven.top/test', 'not-a-url']) {
    assert.equal(run([{ title: 'Offer', description: 'Description', partner: 'Store', url }]).cards.length, 0);
  }
});

test('affiliate module is bundled without altering AdSense publisher inclusion', () => {
  assert.match(homepage, /src="affiliate-offers\.js\?v=20261010-safe-affiliate-1"/);
  assert.match(homepage, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-9356195452195758/);
});
