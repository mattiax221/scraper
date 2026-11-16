const form = document.querySelector('#search');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#results');
const savedEl = document.querySelector('#saved');
const savedStatus = document.querySelector('#saved-status');
const recentsEl = document.querySelector('#recents');
const moreButton = document.querySelector('#more');
const installButton = document.querySelector('#install');
const searchView = document.querySelector('#search-view');
const savedView = document.querySelector('#saved-view');
const when = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

const platformName = {
  subito: 'Subito',
  vinted: 'Vinted',
  wallapop: 'Wallapop',
  depop: 'Depop',
};

const platformLetter = {
  subito: 'S',
  vinted: 'V',
  wallapop: 'W',
  depop: 'D',
};

let page = 1;
let shown = [];
let favorites = new Map();
let deferredInstall = null;

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(amount);
}

function userKey() {
  const existing = localStorage.getItem('usato-key');
  if (existing && /^[A-Za-z0-9_-]{16,80}$/.test(existing)) return existing;
  const created = crypto.randomUUID().replace(/-/g, '');
  localStorage.setItem('usato-key', created);
  return created;
}

function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-user-key', userKey());
  return fetch(path, { ...options, headers });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  installButton.hidden = true;
});

function selectedPlatforms() {
  return [...form.querySelectorAll('input[name="platforms"]:checked')].map((input) => input.value);
}

function readForm() {
  const data = new FormData(form);
  return {
    q: String(data.get('q') || '').trim(),
    city: String(data.get('city') || '').trim(),
    minPrice: String(data.get('minPrice') || '').trim(),
    maxPrice: String(data.get('maxPrice') || '').trim(),
    sort: String(data.get('sort') || 'price_asc'),
    platforms: selectedPlatforms(),
  };
}

function fillForm(query) {
  form.q.value = query.q || '';
  form.city.value = query.city || '';
  form.minPrice.value = query.minPrice ?? '';
  form.maxPrice.value = query.maxPrice ?? '';
  const sort = query.sort === 'price_desc' ? 'price_desc' : 'price_asc';
  form.querySelector(`input[name="sort"][value="${sort}"]`).checked = true;
  const chosen = new Set(String(query.platforms || '').split(',').filter(Boolean));
  for (const input of form.querySelectorAll('input[name="platforms"]')) {
    input.checked = chosen.size ? chosen.has(input.value) : true;
  }
}

function shareParams(query) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.city) params.set('city', query.city);
  if (query.minPrice) params.set('minPrice', query.minPrice);
  if (query.maxPrice) params.set('maxPrice', query.maxPrice);
  params.set('sort', query.sort);
  params.set('platforms', query.platforms.join(','));
  return params;
}

function searchParams(query, pageNumber) {
  const params = shareParams(query);
  params.set('page', String(pageNumber));
  return params;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(true);
});

moreButton.addEventListener('click', () => {
  page += 1;
  runSearch(false);
});

async function runSearch(reset) {
  const query = readForm();
  if (!query.q && !query.city) {
    statusEl.classList.add('error');
    statusEl.textContent = 'Scrivi cosa cerchi, o una città.';
    return;
  }
  if (!query.platforms.length) {
    statusEl.classList.add('error');
    statusEl.textContent = 'Scegli almeno un sito.';
    return;
  }
  if (reset) {
    page = 1;
    shown = [];
    resultsEl.replaceChildren();
    moreButton.hidden = true;
    history.replaceState(null, '', `?${shareParams(query).toString()}`);
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  moreButton.disabled = true;
  statusEl.classList.remove('error');
  statusEl.textContent = 'Cerco…';

  try {
    const response = await api(`/api/search?${searchParams(query, page).toString()}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Ricerca non riuscita');
    render(body, !reset);
    if (reset) loadRecents();
  } catch (error) {
    statusEl.classList.add('error');
    statusEl.textContent = error.message === 'Failed to fetch'
      ? 'Il server non risponde. Avvia il backend e riprova.'
      : error.message;
  } finally {
    submit.disabled = false;
    moreButton.disabled = false;
  }
}

function listingUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, location.origin);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'example.com' || host === 'example.org' || host === 'example.net' || host.endsWith('.example')) {
      return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function render(body, append) {
  const fresh = body.items.filter((item) => !shown.some((saved) => saved.id === item.id));
  shown = shown.concat(fresh);
  const bits = [];
  bits.push(shown.length === 1 ? '1 annuncio' : `${shown.length} annunci`);
  if (body.cached) bits.push('già in cache');
  if (body.query && body.query.city) bits.push(body.query.city);
  for (const failure of body.errors || []) {
    bits.push(`${platformName[failure.platform] || failure.platform} non ha risposto`);
  }
  statusEl.textContent = bits.join(' · ');
  moreButton.hidden = !body.hasMore || fresh.length === 0;

  const fragment = document.createDocumentFragment();
  for (const item of fresh) fragment.append(cardElement(item));
  if (append) resultsEl.append(fragment);
  else resultsEl.replaceChildren(fragment);
}

function cardElement(item) {
  const card = document.createElement('li');
  card.className = 'result';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = favorites.has(item.id) ? 'fav on' : 'fav';
  save.textContent = favorites.has(item.id) ? '♥' : '♡';
  save.setAttribute('aria-label', favorites.has(item.id) ? 'Togli dai preferiti' : 'Salva nei preferiti');
  save.addEventListener('click', () => toggleFavorite(item, save));

  const realUrl = listingUrl(item.url);
  const bodyEl = document.createElement(realUrl ? 'a' : 'article');
  bodyEl.className = 'card';
  if (realUrl) {
    bodyEl.href = realUrl;
    bodyEl.target = '_blank';
    bodyEl.rel = 'noopener noreferrer';
  }

  const thumb = document.createElement('div');
  thumb.className = `thumb ${item.platform}`;
  const letter = document.createElement('span');
  letter.textContent = platformLetter[item.platform] || '?';
  thumb.append(letter);
  const imageUrl = listingUrl(item.image);
  if (imageUrl) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = imageUrl;
    image.addEventListener('error', () => image.remove());
    thumb.append(image);
  }

  const copy = document.createElement('div');
  const platform = document.createElement('span');
  platform.className = `platform ${item.platform}`;
  platform.textContent = platformName[item.platform] || item.platform;
  const title = document.createElement('h2');
  title.textContent = item.title;
  const price = document.createElement('p');
  price.className = 'price';
  price.textContent = formatMoney(item.price, item.currency);
  const meta = document.createElement('p');
  meta.className = 'meta';
  const date = item.date ? when.format(new Date(item.date)) : '';
  meta.textContent = [item.location, date].filter(Boolean).join(' · ');
  copy.append(platform, title, price, meta);
  bodyEl.append(thumb, copy);
  card.append(save, bodyEl);
  return card;
}

async function toggleFavorite(item, button) {
  if (favorites.has(item.id)) {
    const response = await api(`/api/favorites/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    if (!response.ok) return;
    favorites.delete(item.id);
  } else {
    const response = await api('/api/favorites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!response.ok) return;
    favorites.set(item.id, item);
  }
  button.classList.toggle('on', favorites.has(item.id));
  button.textContent = favorites.has(item.id) ? '♥' : '♡';
  button.setAttribute('aria-label', favorites.has(item.id) ? 'Togli dai preferiti' : 'Salva nei preferiti');
  if (!savedView.hidden) showSaved();
}

async function loadFavorites() {
  const response = await api('/api/favorites');
  if (!response.ok) return;
  const body = await response.json();
  favorites = new Map(body.items.map((item) => [item.id, item]));
}

function showSaved() {
  savedEl.replaceChildren();
  if (!favorites.size) {
    savedStatus.textContent = 'Nessun preferito ancora. Il cuore su una scheda lo salva qui.';
    return;
  }
  savedStatus.textContent = favorites.size === 1
    ? '1 annuncio salvato su questo server.'
    : `${favorites.size} annunci salvati su questo server.`;
  const fragment = document.createDocumentFragment();
  for (const item of favorites.values()) fragment.append(cardElement(item));
  savedEl.append(fragment);
}

document.querySelector('#show-search').addEventListener('click', () => {
  searchView.hidden = false;
  savedView.hidden = true;
  document.querySelector('#show-search').setAttribute('aria-pressed', 'true');
  document.querySelector('#show-saved').setAttribute('aria-pressed', 'false');
});

document.querySelector('#show-saved').addEventListener('click', () => {
  searchView.hidden = true;
  savedView.hidden = false;
  document.querySelector('#show-search').setAttribute('aria-pressed', 'false');
  document.querySelector('#show-saved').setAttribute('aria-pressed', 'true');
  showSaved();
});

async function loadRecents() {
  const response = await api('/api/searches');
  if (!response.ok) return;
  const body = await response.json();
  recentsEl.replaceChildren();
  recentsEl.hidden = body.items.length === 0;
  for (const search of body.items) {
    const button = document.createElement('button');
    button.type = 'button';
    const label = [search.q, search.city].filter(Boolean).join(' · ') || 'Ricerca';
    button.textContent = label;
    button.addEventListener('click', () => {
      fillForm(search);
      runSearch(true);
    });
    recentsEl.append(button);
  }
}

const initial = new URLSearchParams(location.search);
if ([...initial.keys()].length) {
  fillForm({
    q: initial.get('q') || '',
    city: initial.get('city') || '',
    minPrice: initial.get('minPrice') || '',
    maxPrice: initial.get('maxPrice') || '',
    sort: initial.get('sort') || 'price_asc',
    platforms: initial.get('platforms') || '',
  });
}

loadFavorites().then(() => {
  loadRecents();
  if (initial.get('q') || initial.get('city')) runSearch(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
