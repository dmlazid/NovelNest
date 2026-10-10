/* Optional, click-only affiliate promotions for NovelHaven.
 * Leave OFFERS empty until the owner supplies a real approved affiliate URL.
 * Example (replace the values and remove the comment):
 * { title: 'Comfortable reading accessories',
 *   description: 'Browse optional accessories for readers.',
 *   partner: 'Store name', url: 'https://example.com/your-affiliate-link' }
 * No redirects, scroll triggers, popups, automatic opens, or tracking requests.
 */
(() => {
  'use strict';

  const OFFERS = [];

  function allowedOffer(item) {
    if (!item || typeof item !== 'object') return false;
    if (![item.title, item.description, item.partner, item.url].every(value =>
      typeof value === 'string' && value.trim())) return false;
    try {
      const destination = new URL(item.url);
      return destination.protocol === 'https:' &&
        !!destination.hostname &&
        destination.origin !== location.origin &&
        !destination.username && !destination.password;
    } catch {
      return false;
    }
  }

  function offerForPage(offers, path) {
    let value = 0;
    for (const character of path) value = (value * 31 + character.charCodeAt(0)) >>> 0;
    return offers[value % offers.length];
  }

  function showAffiliateOffer() {
    const offers = OFFERS.filter(allowedOffer);
    if (!offers.length) return; // An unconfigured promotion is completely invisible.
    const main = document.querySelector('#main');
    if (!main || main.querySelector('[data-affiliate-offer]')) return;
    // Never interrupt a chapter. Only place the optional offer after its content
    // and navigation, or just after the novel details panel.
    const anchor = main.querySelector('.reader-wrap .end-note') ||
      main.querySelector('article.detail');
    if (!anchor) return;

    const offer = offerForPage(offers, location.pathname);
    const card = document.createElement('aside');
    card.className = 'affiliate-offer';
    card.setAttribute('data-affiliate-offer', '');
    card.setAttribute('aria-label', 'Optional affiliate promotion');

    const label = document.createElement('strong');
    label.className = 'affiliate-offer-label';
    label.textContent = 'Affiliate promotion · Optional';
    const headline = document.createElement('h2');
    headline.textContent = offer.title;
    const description = document.createElement('p');
    description.textContent = offer.description;

    const link = document.createElement('a');
    link.className = 'affiliate-offer-link';
    link.href = offer.url;
    link.target = '_blank';
    link.rel = 'sponsored noopener noreferrer';
    link.textContent = 'View offer from ' + offer.partner + ' ↗';

    const disclosure = document.createElement('p');
    disclosure.className = 'affiliate-offer-disclosure';
    disclosure.textContent = 'Affiliate link: NovelHaven may earn a commission if you purchase through this optional link.';
    const details = document.createElement('a');
    details.href = '/advertising-disclosure.html';
    details.textContent = 'Advertising disclosure';

    card.append(label, headline, description, link, disclosure, details);
    anchor.insertAdjacentElement('afterend', card);
  }

  window.addEventListener('novelnest:route-rendered', showAffiliateOffer);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showAffiliateOffer, { once: true });
  } else {
    showAffiliateOffer();
  }
})();
