const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'usato.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    user_key TEXT NOT NULL,
    item_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    image TEXT,
    url TEXT,
    location TEXT,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (user_key, item_id)
  );
  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    q TEXT NOT NULL,
    min_price REAL,
    max_price REAL,
    sort TEXT NOT NULL,
    platforms TEXT NOT NULL,
    city TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function listFavorites(userKey) {
  return db.prepare(`
    SELECT item_id AS id, platform, title, price, currency, image, url, location, saved_at AS savedAt
    FROM favorites
    WHERE user_key = ?
    ORDER BY saved_at DESC
  `).all(userKey);
}

function saveFavorite(userKey, item) {
  db.prepare(`
    INSERT INTO favorites (user_key, item_id, platform, title, price, currency, image, url, location, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key, item_id) DO UPDATE SET
      title = excluded.title,
      price = excluded.price,
      currency = excluded.currency,
      image = excluded.image,
      url = excluded.url,
      location = excluded.location,
      saved_at = excluded.saved_at
  `).run(
    userKey,
    item.id,
    item.platform,
    item.title,
    item.price,
    item.currency,
    item.image || '',
    item.url || '',
    item.location || '',
    new Date().toISOString(),
  );
}

function deleteFavorite(userKey, itemId) {
  db.prepare('DELETE FROM favorites WHERE user_key = ? AND item_id = ?').run(userKey, itemId);
}

function listSearches(userKey) {
  return db.prepare(`
    SELECT q, min_price AS minPrice, max_price AS maxPrice, sort, platforms, city, created_at AS createdAt
    FROM searches
    WHERE user_key = ?
    ORDER BY id DESC
    LIMIT 12
  `).all(userKey);
}

function saveSearch(userKey, query) {
  const latest = db.prepare(`
    SELECT q, min_price AS minPrice, max_price AS maxPrice, sort, platforms, city
    FROM searches
    WHERE user_key = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(userKey);
  const next = {
    q: query.q,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    sort: query.sort,
    platforms: query.platforms,
    city: query.city,
  };
  if (latest && JSON.stringify(latest) === JSON.stringify(next)) return;
  db.prepare(`
    INSERT INTO searches (user_key, q, min_price, max_price, sort, platforms, city, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userKey,
    query.q,
    query.minPrice,
    query.maxPrice,
    query.sort,
    query.platforms,
    query.city,
    new Date().toISOString(),
  );
  db.prepare(`
    DELETE FROM searches
    WHERE user_key = ? AND id NOT IN (
      SELECT id FROM searches WHERE user_key = ? ORDER BY id DESC LIMIT 12
    )
  `).run(userKey, userKey);
}

module.exports = {
  listFavorites,
  saveFavorite,
  deleteFavorite,
  listSearches,
  saveSearch,
};
