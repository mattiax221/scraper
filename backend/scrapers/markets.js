const { readPage } = require('./browser');

function parseEuroNumber(raw) {
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{2})?$/.test(raw)) {
    return Number(raw.replace(/\./g, '').replace(',', '.'));
  }
  if (raw.includes(',') && !raw.includes('.')) return Number(raw.replace(',', '.'));
  return Number(raw);
}

function parseMoney(text) {
  const source = String(text || '');
  const found = [];
  for (const match of source.matchAll(/\$\s*(\d+(?:\.\d{2})?)/g)) {
    found.push({ currency: 'USD', value: Number(match[1]), index: match.index });
  }
  for (const match of source.matchAll(/£\s*(\d+(?:\.\d{2})?)/g)) {
    found.push({ currency: 'GBP', value: Number(match[1]), index: match.index });
  }
  for (const match of source.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+\.\d{2}|\d+,\d{2}|\d+)\s*€/g)) {
    found.push({ currency: 'EUR', value: parseEuroNumber(match[1]), index: match.index });
  }
  const valid = found.filter((entry) => Number.isFinite(entry.value));
  valid.sort((a, b) => a.index - b.index);
  return valid.length ? valid[valid.length - 1] : null;
}

function listingId(platform, url) {
  const match = String(url).match(/(\d{5,})/);
  return `${platform}-${match ? match[1] : Buffer.from(url).toString('base64url').slice(0, 12)}`;
}

function normalize(platform, raw) {
  const money = parseMoney(raw.priceText);
  if (!money || !raw.title || !raw.url) return null;
  return {
    id: listingId(platform, raw.url),
    platform,
    title: raw.title,
    price: money.value,
    currency: money.currency,
    image: raw.image || '',
    url: raw.url,
    location: raw.location || '',
    date: raw.date || '',
  };
}

function pageState(extractItems, limit) {
  const items = extractItems(limit);
  const title = document.title || '';
  const text = (document.body && document.body.innerText || '').slice(0, 240);
  const blocked = /access denied|error page|something went wrong/i.test(`${title} ${text}`);
  return {
    done: blocked,
    blocked,
    title,
    items,
  };
}

function extractSubitoItems(limit) {
  const items = [];
  for (const article of document.querySelectorAll('article')) {
    const link = article.querySelector('a[href*=".htm"]');
    const title = article.querySelector('h3')?.textContent?.trim() || '';
    const priceText = [...article.querySelectorAll('p')].map((el) => el.textContent.trim()).find((text) => text.includes('€')) || '';
    const location = [...article.querySelectorAll('span')].find((el) => String(el.className).includes('location'))?.textContent?.trim() || '';
    const image = article.querySelector('img[alt]')?.currentSrc || article.querySelector('img[alt]')?.src || '';
    if (!link || !title || !priceText) continue;
    if (!/subito\.it\//.test(link.href) || link.href.includes('info.subito.it')) continue;
    items.push({ url: link.href, title, priceText, location, image });
    if (items.length >= (limit || 15)) break;
  }
  return items;
}

function extractVintedItems(limit) {
  const items = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('a[data-testid*="overlay-link"]')) {
    const rawTitle = link.getAttribute('title') || '';
    const idMatch = link.href.match(/\/items\/(\d+)/);
    if (!rawTitle || !idMatch || seen.has(idMatch[1])) continue;
    seen.add(idMatch[1]);
    let node = link;
    let image = '';
    for (let step = 0; step < 6 && node; step += 1) {
      const img = node.querySelector('img');
      if (img && img.src && !img.src.startsWith('data:')) {
        image = img.currentSrc || img.src;
        break;
      }
      node = node.parentElement;
    }
    items.push({
      url: link.href.split('?')[0],
      title: rawTitle.split(/,\s*(?:Brand|Condizioni):/i)[0].trim(),
      priceText: rawTitle,
      location: '',
      image,
    });
    if (items.length >= (limit || 15)) break;
  }
  return items;
}

function extractWallapopItems(limit) {
  const items = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('a[href*="/item/"]')) {
    const href = link.href.split('?')[0];
    if (!href.includes('wallapop.com/item/') || seen.has(href)) continue;
    seen.add(href);
    const article = link.closest('article') || link;
    const title = link.getAttribute('aria-label') || article.querySelector('img[alt]')?.alt || '';
    const priceText = (article.innerText || '').replace(/\s+/g, ' ');
    const image = article.querySelector('img[alt]')?.currentSrc || article.querySelector('img[alt]')?.src || '';
    if (!title || !priceText.includes('€')) continue;
    items.push({ url: href, title, priceText, location: '', image });
    if (items.length >= (limit || 15)) break;
  }
  return items;
}

function extractDepopItems(limit) {
  const items = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('a[href*="/products/"]')) {
    const href = link.href.split('?')[0];
    if (!href.includes('depop.com/products/') || seen.has(href)) continue;
    seen.add(href);
    const card = link.closest('li') || link.parentElement || link;
    const title = link.getAttribute('aria-label') || link.querySelector('img')?.alt || '';
    const priceText = (card.innerText || '').replace(/\s+/g, ' ');
    const images = [...link.querySelectorAll('img')];
    const photo = images.find((img) => !String(img.className).toLowerCase().includes('blur')) || images[0];
    if (!title || !/[€$£]/.test(priceText)) continue;
    items.push({
      url: href,
      title,
      priceText,
      location: '',
      image: photo ? (photo.currentSrc || photo.src) : '',
    });
    if (items.length >= (limit || 15)) break;
  }
  return items;
}

function words(q, city) {
  return [q, city].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
}

async function searchSite(platform, url, extractItems, { limit = 15, scroll = false } = {}) {
  const expression = `(() => {
    if (${scroll ? 'true' : 'false'}) window.scrollTo(0, document.body.scrollHeight);
    return (${pageState.toString()})(${extractItems.toString()}, ${Number(limit)});
  })()`;
  const pageResult = await readPage(url, expression, 22000, scroll ? Number(limit) : 8);
  const stillChecking = /just a moment|verifying you are human/i.test(pageResult && pageResult.title || '');
  if (!pageResult || pageResult.blocked || stillChecking || !Array.isArray(pageResult.items) || !pageResult.title) {
    throw new Error(`${platform} ha rifiutato la richiesta`);
  }
  return pageResult.items.map((item) => normalize(platform, item)).filter(Boolean);
}

function searchSubito({ q, minPrice, maxPrice, city, page = 1 }) {
  const params = new URLSearchParams();
  const query = words(q, city);
  if (query) params.set('q', query);
  if (minPrice != null) params.set('ps', String(Math.round(minPrice)));
  if (maxPrice != null) params.set('pe', String(Math.round(maxPrice)));
  if (page > 1) params.set('o', String(page));
  const url = `https://www.subito.it/annunci-italia/vendita/usato/?${params.toString()}`;
  return searchSite('subito', url, extractSubitoItems, { limit: 15 });
}

function searchVinted({ q, minPrice, maxPrice, city, page = 1 }) {
  const params = new URLSearchParams({ search_text: words(q, city), currency: 'EUR' });
  if (minPrice != null) params.set('price_from', String(minPrice));
  if (maxPrice != null) params.set('price_to', String(maxPrice));
  if (page > 1) params.set('page', String(page));
  const url = `https://www.vinted.it/catalog?${params.toString()}`;
  return searchSite('vinted', url, extractVintedItems, { limit: 15 });
}

function searchWallapop({ q, minPrice, maxPrice, city, page = 1 }) {
  const params = new URLSearchParams({ keywords: words(q, city) });
  if (minPrice != null) params.set('min_sale_price', String(Math.round(minPrice)));
  if (maxPrice != null) params.set('max_sale_price', String(Math.round(maxPrice)));
  const url = `https://it.wallapop.com/search?${params.toString()}`;
  const limit = page * 15;
  return searchSite('wallapop', url, extractWallapopItems, { limit, scroll: page > 1 })
    .then((items) => items.slice((page - 1) * 15, page * 15));
}

function searchDepop({ q, minPrice, maxPrice, city, page = 1 }) {
  const params = new URLSearchParams({ q: words(q, city) });
  if (minPrice != null) params.set('priceMin', String(Math.round(minPrice)));
  if (maxPrice != null) params.set('priceMax', String(Math.round(maxPrice)));
  if (page > 1) params.set('page', String(page));
  const url = `https://www.depop.com/search/?${params.toString()}`;
  return searchSite('depop', url, extractDepopItems, { limit: 15 });
}

module.exports = {
  searchSubito,
  searchVinted,
  searchWallapop,
  searchDepop,
};
