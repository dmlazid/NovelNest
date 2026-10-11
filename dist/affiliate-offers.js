/* Optional click-only affiliate promotions for NovelHaven. The short-link destinations
 * could not be independently verified, so do not make claims about merchants or products.
 * All offers are user-initiated, visibly disclosed, and remain after reading content.
 */
(() => {
  'use strict';

  const OFFERS = [
    {"title":"Butterfly Foldable Bag Hook","description":"Portable purse hanger with a sparkly butterfly design. Several colors are shown in the listing.","partner":"Shopee","url":"https://invl.me/clo37p0","image":"/assets/affiliate-butterfly-hook.jpg","price":"₱135","priceNote":"After voucher in screenshot · 11 Oct 2026","sold":"617 sold (at screenshot)"},
    {"title":"PopTips 10pcs Press-On Nails","description":"Short square, reusable press-on nails in soft everyday shades.","partner":"Shopee","url":"https://invl.me/clo37pl","image":"/assets/affiliate-poptips-nails.jpg","price":"₱39","oldPrice":"₱78","priceNote":"Screenshot price · 11 Oct 2026","sold":"3K+ sold (at screenshot)"},
    {"title":"Discover another Shopee find","description":"Browse this optional partner offer. See the seller's page for product photos, choices, and current prices.","partner":"Shopee","url":"https://invl.me/clo37pr"},
    {"title":"Discover another Shopee find","description":"Browse this optional partner offer. See the seller's page for product photos, choices, and current prices.","partner":"Shopee","url":"https://invl.me/clo37q9"},
    {"title":"Discover another Shopee find","description":"Browse this optional partner offer. See the seller's page for product photos, choices, and current prices.","partner":"Shopee","url":"https://invl.me/clo37qk"}
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

    const media = document.createElement('div');
    media.className = 'affiliate-offer-media';
    if (typeof offer.image === 'string' && /^\/assets\/affiliate-[a-z0-9-]+\.jpg$/.test(offer.image)) {
      const photo = document.createElement('img');
      photo.src = offer.image;
      photo.alt = offer.title;
      photo.loading = 'lazy';
      photo.decoding = 'async';
      photo.width = 128;
      photo.height = 128;
      media.append(photo);
    } else {
      media.className += ' affiliate-offer-placeholder';
      media.textContent = 'SHOPPING FIND';
    }

    const info = document.createElement('div');
    info.className = 'affiliate-offer-info';
    const label = document.createElement('strong');
    label.className = 'affiliate-offer-label';
    label.textContent = 'Sponsored · Affiliate pick';
    const headline = document.createElement('h2');
    headline.textContent = offer.title;
    const description = document.createElement('p');
    description.textContent = offer.description;
    info.append(label, headline);
    if (offer.price) {
      const price = document.createElement('div');
      price.className = 'affiliate-offer-pricing';
      const current = document.createElement('strong');
      current.className = 'affiliate-offer-price';
      current.textContent = offer.price;
      price.append(current);
      if (offer.oldPrice) {
        const oldPrice = document.createElement('span');
        oldPrice.className = 'affiliate-offer-old-price';
        oldPrice.textContent = offer.oldPrice;
        price.append(oldPrice);
      }
      info.append(price);
    }
    info.append(description);
    if (offer.sold) {
      const sold = document.createElement('span');
      sold.className = 'affiliate-offer-sold';
      sold.textContent = offer.sold;
      info.append(sold);
    }
    if (offer.priceNote) {
      const priceNote = document.createElement('small');
      priceNote.className = 'affiliate-offer-price-note';
      priceNote.textContent = offer.priceNote + ' · Actual price may change.';
      info.append(priceNote);
    }

    const link = document.createElement('a');
    link.className = 'affiliate-offer-link';
    link.href = offer.url; // ALWAYS the original Involve Asia affiliate link.
    link.target = '_blank';
    link.rel = 'sponsored noopener noreferrer';
    link.textContent = 'View product on ' + offer.partner + ' ↗';
    info.append(link);

    const disclosure = document.createElement('div');
    disclosure.className = 'affiliate-offer-disclosure';
    const disclosureText = document.createElement('p');
    disclosureText.textContent = 'Affiliate link: NovelHaven may earn a commission from a qualifying purchase. Offers are optional.';
    const details = document.createElement('a');
    details.href = '/advertising-disclosure.html';
    details.textContent = 'Advertising disclosure';
    disclosure.append(disclosureText, details);

    card.append(media, info, disclosure);
    anchor.insertAdjacentElement('afterend', card);
  }

  window.addEventListener('novelnest:route-rendered', showAffiliateOffer);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showAffiliateOffer, { once: true });
  } else {
    showAffiliateOffer();
  }
})();
