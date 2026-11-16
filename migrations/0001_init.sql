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
