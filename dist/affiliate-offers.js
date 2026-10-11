/* Optional click-only affiliate offers. Photos and indicative prices come from
 * owner-supplied product listings. Keep Involve Asia URLs as purchase destinations.
 * Never open links automatically or place sponsored items inside chapter prose.
 */
(() => {
  'use strict';

  const OFFERS = [
    {"title":"Butterfly Foldable Bag Hook","description":"Sparkly butterfly bag hook to accessorize your handbag.","partner":"Shopee","url":"https://invl.me/clo37p0","referenceUrl":"https://s.shopee.ph/3LRVoV9lyL","imageIndex":0,"price":"₱135","sold":"617 sold"},
    {"title":"PopTips Clean Girl Press-On Nails","description":"Reusable short square nails in soft, everyday colors.","partner":"Shopee","url":"https://invl.me/clo37pl","referenceUrl":"https://s.shopee.ph/8KqBljOeB","imageIndex":1,"price":"₱39","oldPrice":"₱78","sold":"3K+ sold"},
    {"title":"POPTIPS Handmade 3D Floral Nails","description":"Colorful 3D floral press-on nails with blue and pink styles.","partner":"Shopee","url":"https://invl.me/clo37pr","referenceUrl":"https://s.shopee.ph/4qGJbKNTzV","imageIndex":2,"price":"₱39–₱99","sold":"10K+ sold"},
    {"title":"DIY 3D Miniature Model House","description":"Cute colorful miniature houses to assemble and display.","partner":"Shopee","url":"https://invl.me/clo37q9","referenceUrl":"https://s.shopee.ph/2gBp1N9XkQ","imageIndex":3,"price":"From ₱49","sold":"10K+ sold"},
    {"title":"CIVAGO 22oz Insulated Tumbler","description":"Leopard-style water bottle with a wide mouth and sport lid.","partner":"Shopee","url":"https://invl.me/clo37qk","referenceUrl":"https://s.shopee.ph/BUU3ChcOO","imageIndex":4,"price":"₱368","sold":"10K+ sold"}
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
    if (Number.isInteger(offer.imageIndex) && offer.imageIndex >= 0 && offer.imageIndex < 5) {
      const photo = document.createElement('img');
      photo.src = '/assets/affiliate-hero-sprite.webp';
      photo.alt = offer.title + ' product photograph';
      photo.loading = 'lazy';
      photo.decoding = 'async';
      photo.width = 1100;
      photo.height = 165;
      photo.setAttribute('data-sprite-index', String(offer.imageIndex));
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
