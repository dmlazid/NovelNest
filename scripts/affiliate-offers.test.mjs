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
  const modified = source.replace(/const OFFERS = \[[\s\S]*?\];/, 'const OFFERS = ' + JSON.stringify(offers) + ';');
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

test('safe voluntary product link includes image, price, disclosure, and sponsored rel', () => {
  const { cards, handlers } = run([{
    title: 'Butterfly Foldable Bag Hook', description: 'Optional item',
    partner: 'Shopee', url: 'https://invl.me/clo37p0',
    image: '/assets/affiliate-butterfly-hook.jpg', price: '₱135',
    sold: '617 sold', priceNote: 'Screenshot price',
  }]);
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.tag, 'aside');
  assert.equal(card['data-affiliate-offer'], '');
  const descendants = [];
  function visit(node) { descendants.push(node); for (const child of node.children || []) visit(child); }
  visit(card);
  const link = descendants.find(x => x.tag === 'a' && x.href?.startsWith('https://'));
  assert.equal(link.href, 'https://invl.me/clo37p0');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'sponsored noopener noreferrer');
  assert(descendants.some(x => x.tag === 'img' && x.src === '/assets/affiliate-butterfly-hook.jpg'));
  assert(descendants.some(x => x.textContent === '₱135'));
  assert(descendants.some(x => x.textContent?.includes('commission')));
  assert(descendants.some(x => x.href === '/advertising-disclosure.html'));
  handlers['novelnest:route-rendered']();
  assert.equal(cards.length, 1, 'duplicate promotion must not be added');
});

test('invalid and unsafe affiliate destinations are ignored', () => {
  for (const url of ['javascript:alert(1)', 'http://example.com/', 'https://novelhaven.top/test', 'not-a-url']) {
    assert.equal(run([{ title: 'Offer', description: 'Description', partner: 'Store', url }]).cards.length, 0);
  }
});

test('affiliate module is bundled without altering AdSense publisher inclusion', () => {
  assert.match(homepage, /src="affiliate-offers\.js\?v=20261011-product-cards-1"/);
  assert.match(homepage, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-9356195452195758/);
});

test('only five user-provided affiliate links are configured', () => {
  const found = [...source.matchAll(/url:\s*'(https:\/\/invl\.me\/[^']+)'/g)].map(match => match[1]);
  assert.deepEqual(found, [
    'https://invl.me/clo37p0',
    'https://invl.me/clo37pl',
    'https://invl.me/clo37pr',
    'https://invl.me/clo37q9',
    'https://invl.me/clo37qk',
  ]);
});

test('real product thumbnails are stored locally and all four Shopee reference URLs are never used as checkout links', () => {
  for (const image of ['butterfly-hook', 'poptips-nails']) {
    assert.match(source, new RegExp('/assets/affiliate-' + image + '\\.jpg'));
  }
  assert.doesNotMatch(source, /href\\s*=\\s*['\"]https:\\/\\/s\\.shopee\\.ph\\//);
});
