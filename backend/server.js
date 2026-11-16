require('dotenv').config({
  path: require('path').join(__dirname, '.env'),
  quiet: true,
});

const path = require('path');
const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const { searchSubito, searchVinted, searchWallapop, searchDepop } = require('./scrapers/markets');
const saved = require('./db');

const PLATFORMS = ['subito', 'vinted', 'wallapop', 'depop'];

const PORT = Number(process.env.PORT) || 3001;
const CACHE_TTL_SECONDS = 600;

const scrapers = [
  { platform: 'subito', search: searchSubito },
  { platform: 'vinted', search: searchVinted },
  { platform: 'wallapop', search: searchWallapop },
  { platform: 'depop', search: searchDepop },
];

const cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS });

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

function parseBound(value) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return number;
}

function normalizePlatforms(value) {
  if (value == null || value === '') {
    return '';
  }
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

function normalizeQuery(raw) {
  const q = raw.q == null ? '' : String(raw.q).trim().slice(0, 80);
  const sort = raw.sort == null || raw.sort === '' ? 'price_asc' : String(raw.sort);
  const minPrice = parseBound(raw.minPrice);
  const maxPrice = parseBound(raw.maxPrice);
  const platforms = normalizePlatforms(raw.platforms);
  const city = raw.city == null ? '' : String(raw.city).trim().slice(0, 40);
  const page = raw.page == null || raw.page === '' ? 1 : Number(raw.page);

  if (sort !== 'price_asc' && sort !== 'price_desc') {
    return { error: 'sort must be price_asc or price_desc' };
  }
  if (minPrice === undefined) {
    return { error: 'minPrice must be a number' };
  }
  if (maxPrice === undefined) {
    return { error: 'maxPrice must be a number' };
  }
  if (!Number.isInteger(page) || page < 1 || page > 8) {
    return { error: 'page must be from 1 to 8' };
  }
  if (city && !/^[\p{L}\s'.-]+$/u.test(city)) {
    return { error: 'city must be a place name' };
  }
  const chosen = platforms ? platforms.split(',') : PLATFORMS;
  if (!chosen.length || chosen.some((name) => !PLATFORMS.includes(name))) {
    return { error: 'platforms must be subito, vinted, wallapop or depop' };
  }

  return { q, minPrice, maxPrice, sort, platforms: chosen.join(','), city, page };
}

function cacheKey(query) {
  return JSON.stringify({
    q: query.q,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    sort: query.sort,
    platforms: query.platforms,
    city: query.city,
    page: query.page,
  });
}

let rates = { at: 0, USD: null, GBP: null };

async function euroValue(price, currency) {
  if (!currency || currency === 'EUR') return price;
  if (Date.now() - rates.at > 12 * 60 * 60 * 1000 || rates.USD == null) {
    try {
      const response = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD,GBP');
      const body = await response.json();
      rates = { at: Date.now(), USD: body.rates.USD, GBP: body.rates.GBP };
    } catch {
      rates.at = Date.now();
    }
  }
  const perEuro = rates[currency];
  if (!perEuro) return null;
  return price / perEuro;
}

async function withinPrice(item, minPrice, maxPrice) {
  if (minPrice == null && maxPrice == null) return true;
  const euros = await euroValue(item.price, item.currency);
  if (euros == null) return true;
  if (minPrice != null && euros < minPrice) return false;
  if (maxPrice != null && euros > maxPrice) return false;
  return true;
}

async function mergeSettled(results, query, active) {
  const items = [];
  const errors = [];

  results.forEach((result, index) => {
    const platform = active[index].platform;
    if (result.status === 'fulfilled') {
      const listings = Array.isArray(result.value) ? result.value : [];
      items.push(...listings);
      return;
    }
    const reason = result.reason;
    errors.push({
      platform,
      message: reason && reason.message ? reason.message : String(reason),
    });
  });

  const filtered = [];
  for (const item of items) {
    if (await withinPrice(item, query.minPrice, query.maxPrice)) filtered.push(item);
  }
  filtered.sort((a, b) => (query.sort === 'price_desc' ? b.price - a.price : a.price - b.price));

  return {
    query: {
      q: query.q,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      sort: query.sort,
      platforms: query.platforms,
      city: query.city,
      page: query.page,
    },
    items: filtered,
    errors,
    hasMore: items.length >= 8,
  };
}

function userKey(req) {
  const key = String(req.get('x-user-key') || '');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) return '';
  return key;
}

function favoriteFromBody(body) {
  const item = body || {};
  const id = String(item.id || '').slice(0, 80);
  const platform = String(item.platform || '');
  const title = String(item.title || '').trim().slice(0, 300);
  const price = Number(item.price);
  const currency = String(item.currency || 'EUR').slice(0, 8);
  if (!id || !PLATFORMS.includes(platform) || !title || !Number.isFinite(price)) return null;
  return {
    id,
    platform,
    title,
    price,
    currency,
    image: String(item.image || '').slice(0, 500),
    url: String(item.url || '').slice(0, 500),
    location: String(item.location || '').slice(0, 120),
  };
}

app.get('/api/search', async (req, res) => {
  const query = normalizeQuery(req.query);
  if (query.error) {
    res.status(400).json({ error: query.error });
    return;
  }

  const key = userKey(req);
  if (key && query.page === 1) saved.saveSearch(key, query);

  const cacheId = cacheKey(query);
  const hit = cache.get(cacheId);
  if (hit) {
    res.json({ ...hit, cached: true });
    return;
  }

  const chosen = new Set(query.platforms.split(','));
  const active = scrapers.filter((scraper) => chosen.has(scraper.platform));
  const settled = await Promise.allSettled(active.map((scraper) => scraper.search(query)));
  const payload = await mergeSettled(settled, query, active);
  cache.set(cacheId, payload);
  res.json({ ...payload, cached: false });
});

app.get('/api/favorites', (req, res) => {
  const key = userKey(req);
  if (!key) {
    res.status(400).json({ error: 'missing user key' });
    return;
  }
  res.json({ items: saved.listFavorites(key) });
});

app.post('/api/favorites', (req, res) => {
  const key = userKey(req);
  const item = favoriteFromBody(req.body);
  if (!key || !item) {
    res.status(400).json({ error: 'invalid favorite' });
    return;
  }
  saved.saveFavorite(key, item);
  res.status(201).json({ ok: true });
});

app.delete('/api/favorites/:id', (req, res) => {
  const key = userKey(req);
  if (!key) {
    res.status(400).json({ error: 'missing user key' });
    return;
  }
  saved.deleteFavorite(key, req.params.id);
  res.json({ ok: true });
});

app.get('/api/searches', (req, res) => {
  const key = userKey(req);
  if (!key) {
    res.status(400).json({ error: 'missing user key' });
    return;
  }
  res.json({ items: saved.listSearches(key) });
});

const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  },
}));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
  });
}

module.exports = {
  app,
  cache,
  mergeSettled,
  normalizeQuery,
  cacheKey,
};
