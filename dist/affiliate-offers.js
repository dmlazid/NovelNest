/* Optional click-only affiliate promotions for NovelHaven. The short-link destinations
 * could not be independently verified, so do not make claims about merchants or products.
 * All offers are user-initiated, visibly disclosed, and remain after reading content.
 */
(() => {
  'use strict';

  const OFFERS = [
    { title: 'Optional partner offer', description: 'Explore this external offer if interested. Check the partner website for current details, availability, and prices.', partner: 'the partner site', url: 'https://invl.me/clo37p0' },
    { title: 'Optional partner offer', description: 'Explore this external offer if interested. Check the partner website for current details, availability, and prices.', partner: 'the partner site', url: 'https://invl.me/clo37pl' },
    { title: 'Optional partner offer', description: 'Explore this external offer if interested. Check the partner website for current details, availability, and prices.', partner: 'the partner site', url: 'https://invl.me/clo37pr' },
    { title: 'Optional partner offer', description: 'Explore this external offer if interested. Check the partner website for current details, availability, and prices.', partner: 'the partner site', url: 'https://invl.me/clo37q9' },
    { title: 'Optional partner offer', description: 'Explore this external offer if interested. Check the partner website for current details, availability, and prices.', partner: 'the partner site', url: 'https://invl.me/clo37qk' }
  ];

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
