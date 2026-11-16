import puppeteer from "@cloudflare/puppeteer";

const PLATFORMS = ["subito", "vinted", "wallapop", "depop"];

function words(q, city) {
  return [q, city].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function siteUrl(platform, query) {
  const page = query.page || 1;
  if (platform === "subito") {
    const params = new URLSearchParams();
    const text = words(query.q, query.city);
    if (text) params.set("q", text);
    if (query.minPrice != null) params.set("ps", String(Math.round(query.minPrice)));
    if (query.maxPrice != null) params.set("pe", String(Math.round(query.maxPrice)));
    if (page > 1) params.set("o", String(page));
    return `https://www.subito.it/annunci-italia/vendita/usato/?${params.toString()}`;
  }
  if (platform === "vinted") {
    const params = new URLSearchParams({
      search_text: words(query.q, query.city),
      currency: "EUR",
    });
    if (query.minPrice != null) params.set("price_from", String(query.minPrice));
    if (query.maxPrice != null) params.set("price_to", String(query.maxPrice));
    if (page > 1) params.set("page", String(page));
    return `https://www.vinted.it/catalog?${params.toString()}`;
  }
  if (platform === "wallapop") {
    const params = new URLSearchParams({ keywords: words(query.q, query.city) });
    if (query.minPrice != null) params.set("min_sale_price", String(Math.round(query.minPrice)));
    if (query.maxPrice != null) params.set("max_sale_price", String(Math.round(query.maxPrice)));
    return `https://it.wallapop.com/search?${params.toString()}`;
  }
  const params = new URLSearchParams({ q: words(query.q, query.city) });
  if (query.minPrice != null) params.set("priceMin", String(Math.round(query.minPrice)));
  if (query.maxPrice != null) params.set("priceMax", String(Math.round(query.maxPrice)));
  if (page > 1) params.set("page", String(page));
  return `https://www.depop.com/search/?${params.toString()}`;
}

function parseEuroNumber(raw) {
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{2})?$/.test(raw)) {
    return Number(raw.replace(/\./g, "").replace(",", "."));
  }
  if (raw.includes(",") && !raw.includes(".")) return Number(raw.replace(",", "."));
  return Number(raw);
}

function parseMoney(text) {
  const source = String(text || "");
  const found = [];
  for (const match of source.matchAll(/\$\s*(\d+(?:\.\d{2})?)/g)) {
    found.push({ currency: "USD", value: Number(match[1]), index: match.index });
  }
  for (const match of source.matchAll(/£\s*(\d+(?:\.\d{2})?)/g)) {
    found.push({ currency: "GBP", value: Number(match[1]), index: match.index });
  }
  for (const match of source.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+\.\d{2}|\d+,\d{2}|\d+)\s*€/g)) {
    found.push({ currency: "EUR", value: parseEuroNumber(match[1]), index: match.index });
  }
  const valid = found.filter((entry) => Number.isFinite(entry.value));
  valid.sort((a, b) => a.index - b.index);
  return valid.length ? valid[valid.length - 1] : null;
}

function listingId(platform, url) {
  const match = String(url).match(/(\d{5,})/);
  return `${platform}-${match ? match[1] : btoa(url).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
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
    image: raw.image || "",
    url: raw.url,
    location: raw.location || "",
    date: "",
  };
}

function collectListings(platform, limit, scroll) {
  if (scroll) window.scrollTo(0, document.body.scrollHeight);
  const consent = [...document.querySelectorAll("button, a")].find((el) =>
    /continua senza accettare/i.test(el.textContent || "")
  );
  if (consent) consent.click();
  const cap = limit || 15;
  const items = [];
  if (platform === "subito") {
    for (const article of document.querySelectorAll("article")) {
      const link = article.querySelector('a[href*=".htm"]');
      const title = article.querySelector("h3")?.textContent?.trim() || "";
      const priceText = [...article.querySelectorAll("p")].map((el) => el.textContent.trim()).find((text) => text.includes("€")) || "";
      const location = [...article.querySelectorAll("span")].find((el) => String(el.className).includes("location"))?.textContent?.trim() || "";
      const image = article.querySelector("img[alt]")?.currentSrc || article.querySelector("img[alt]")?.src || "";
      if (!link || !title || !priceText) continue;
      if (!/subito\.it\//.test(link.href) || link.href.includes("info.subito.it")) continue;
      items.push({ url: link.href, title, priceText, location, image });
      if (items.length >= cap) break;
    }
  } else if (platform === "vinted") {
    const seen = new Set();
    for (const link of document.querySelectorAll('a[data-testid*="overlay-link"]')) {
      const rawTitle = link.getAttribute("title") || "";
      const idMatch = link.href.match(/\/items\/(\d+)/);
      if (!rawTitle || !idMatch || seen.has(idMatch[1])) continue;
      seen.add(idMatch[1]);
      let node = link;
      let image = "";
      for (let step = 0; step < 6 && node; step += 1) {
        const img = node.querySelector("img");
        if (img && img.src && !img.src.startsWith("data:")) {
          image = img.currentSrc || img.src;
          break;
        }
        node = node.parentElement;
      }
      items.push({
        url: link.href.split("?")[0],
        title: rawTitle.split(/,\s*(?:Brand|Condizioni):/i)[0].trim(),
        priceText: rawTitle,
        location: "",
        image,
      });
      if (items.length >= cap) break;
    }
  } else if (platform === "wallapop") {
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href*="/item/"]')) {
      const href = link.href.split("?")[0];
      if (!href.includes("wallapop.com/item/") || seen.has(href)) continue;
      seen.add(href);
      const article = link.closest("article") || link;
      const title = link.getAttribute("aria-label") || article.querySelector("img[alt]")?.alt || "";
      const priceText = (article.innerText || "").replace(/\s+/g, " ");
      const image = article.querySelector("img[alt]")?.currentSrc || article.querySelector("img[alt]")?.src || "";
      if (!title || !priceText.includes("€")) continue;
      items.push({ url: href, title, priceText, location: "", image });
      if (items.length >= cap) break;
    }
  } else {
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href*="/products/"]')) {
      const href = link.href.split("?")[0];
      if (!href.includes("depop.com/products/") || seen.has(href)) continue;
      seen.add(href);
      const card = link.closest("li") || link.parentElement || link;
      const title = link.getAttribute("aria-label") || link.querySelector("img")?.alt || "";
      const priceText = (card.innerText || "").replace(/\s+/g, " ");
      const images = [...link.querySelectorAll("img")];
      const photo = images.find((img) => !String(img.className).toLowerCase().includes("blur")) || images[0];
      if (!title || !/[€$£]/.test(priceText)) continue;
      items.push({
        url: href,
        title,
        priceText,
        location: "",
        image: photo ? photo.currentSrc || photo.src : "",
      });
      if (items.length >= cap) break;
    }
  }
  const title = document.title || "";
  const text = (document.body && document.body.innerText || "").slice(0, 240);
  const blocked = /access denied|error page|something went wrong|forbidden/i.test(`${title} ${text}`);
  return { title, blocked, items };
}

async function readSite(browser, platform, query) {
  const page = await browser.newPage();
  const limit = platform === "wallapop" ? query.page * 15 : 15;
  try {
    await page.goto(siteUrl(platform, query), { waitUntil: "domcontentloaded", timeout: 25000 });
    const started = Date.now();
    let last = { title: "", blocked: false, items: [] };
    let previous = -1;
    let stable = 0;
    while (Date.now() - started < 18000) {
      last = await page.evaluate(collectListings, platform, limit, query.page > 1);
      if (last.blocked) break;
      const count = last.items.length;
      if (count >= 8 && count === previous) {
        stable += 1;
        if (stable >= 2) break;
      } else {
        stable = 0;
      }
      previous = count;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (last.blocked || /just a moment|verifying you are human/i.test(last.title || "")) {
      throw new Error(`${platform} ha rifiutato la richiesta`);
    }
    let items = last.items.map((item) => normalize(platform, item)).filter(Boolean);
    if (platform === "wallapop" && query.page > 1) {
      items = items.slice((query.page - 1) * 15, query.page * 15);
    }
    return items;
  } finally {
    await page.close();
  }
}

function parseBound(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return number;
}

function normalizeQuery(raw) {
  const q = raw.get("q") == null ? "" : String(raw.get("q")).trim().slice(0, 80);
  const sort = raw.get("sort") || "price_asc";
  const minPrice = parseBound(raw.get("minPrice"));
  const maxPrice = parseBound(raw.get("maxPrice"));
  const city = raw.get("city") == null ? "" : String(raw.get("city")).trim().slice(0, 40);
  const page = raw.get("page") == null || raw.get("page") === "" ? 1 : Number(raw.get("page"));
  const platformsRaw = raw.get("platforms");
  const chosen = platformsRaw
    ? platformsRaw.split(",").map((name) => name.trim()).filter(Boolean).sort()
    : PLATFORMS;
  if (sort !== "price_asc" && sort !== "price_desc") return { error: "sort must be price_asc or price_desc" };
  if (minPrice === undefined) return { error: "minPrice must be a number" };
  if (maxPrice === undefined) return { error: "maxPrice must be a number" };
  if (!Number.isInteger(page) || page < 1 || page > 8) return { error: "page must be from 1 to 8" };
  if (city && !/^[\p{L}\s'.-]+$/u.test(city)) return { error: "city must be a place name" };
  if (!chosen.length || chosen.some((name) => !PLATFORMS.includes(name))) {
    return { error: "platforms must be subito, vinted, wallapop or depop" };
  }
  return { q, minPrice, maxPrice, sort, platforms: chosen.join(","), city, page };
}

let rates = { at: 0, USD: null, GBP: null };

async function euroValue(price, currency) {
  if (!currency || currency === "EUR") return price;
  if (Date.now() - rates.at > 12 * 60 * 60 * 1000 || rates.USD == null) {
    try {
      const response = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD,GBP");
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

function userKey(request) {
  const key = request.headers.get("x-user-key") || "";
  return /^[A-Za-z0-9_-]{16,80}$/.test(key) ? key : "";
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "access-control-allow-origin": "*" },
  });
}

async function search(request, env) {
  const query = normalizeQuery(new URL(request.url).searchParams);
  if (query.error) return json({ error: query.error }, 400);
  const key = userKey(request);
  if (key && query.page === 1) await saveSearch(env, key, query);

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const chosen = query.platforms.split(",");
    const settled = await Promise.allSettled(chosen.map((platform) => readSite(browser, platform, query)));
    const items = [];
    const errors = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") items.push(...result.value);
      else errors.push({ platform: chosen[index], message: result.reason?.message || String(result.reason) });
    });
    const filtered = [];
    for (const item of items) {
      if (await withinPrice(item, query.minPrice, query.maxPrice)) filtered.push(item);
    }
    filtered.sort((a, b) => (query.sort === "price_desc" ? b.price - a.price : a.price - b.price));
    return json({
      query,
      items: filtered,
      errors,
      hasMore: items.length >= 8,
      cached: false,
    });
  } finally {
    await browser.close();
  }
}

async function saveSearch(env, userKeyValue, query) {
  const latest = await env.DB.prepare(
    `SELECT q, min_price AS minPrice, max_price AS maxPrice, sort, platforms, city
     FROM searches WHERE user_key = ? ORDER BY id DESC LIMIT 1`
  ).bind(userKeyValue).first();
  const next = {
    q: query.q,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    sort: query.sort,
    platforms: query.platforms,
    city: query.city,
  };
  if (latest && JSON.stringify(latest) === JSON.stringify(next)) return;
  await env.DB.prepare(
    `INSERT INTO searches (user_key, q, min_price, max_price, sort, platforms, city, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userKeyValue,
    query.q,
    query.minPrice,
    query.maxPrice,
    query.sort,
    query.platforms,
    query.city,
    new Date().toISOString(),
  ).run();
}

async function favorites(request, env, id) {
  const key = userKey(request);
  if (!key) return json({ error: "missing user key" }, 400);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT item_id AS id, platform, title, price, currency, image, url, location, saved_at AS savedAt
       FROM favorites WHERE user_key = ? ORDER BY saved_at DESC`
    ).bind(key).all();
    return json({ items: rows.results || [] });
  }
  if (request.method === "POST") {
    const body = await request.json();
    const platform = String(body.platform || "");
    const title = String(body.title || "").trim().slice(0, 300);
    const price = Number(body.price);
    const itemId = String(body.id || "").slice(0, 80);
    if (!itemId || !PLATFORMS.includes(platform) || !title || !Number.isFinite(price)) {
      return json({ error: "invalid favorite" }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO favorites (user_key, item_id, platform, title, price, currency, image, url, location, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_key, item_id) DO UPDATE SET
         title = excluded.title, price = excluded.price, currency = excluded.currency,
         image = excluded.image, url = excluded.url, location = excluded.location, saved_at = excluded.saved_at`
    ).bind(
      key,
      itemId,
      platform,
      title,
      price,
      String(body.currency || "EUR").slice(0, 8),
      String(body.image || "").slice(0, 500),
      String(body.url || "").slice(0, 500),
      String(body.location || "").slice(0, 120),
      new Date().toISOString(),
    ).run();
    return json({ ok: true }, 201);
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM favorites WHERE user_key = ? AND item_id = ?").bind(key, id).run();
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}

async function searches(request, env) {
  const key = userKey(request);
  if (!key) return json({ error: "missing user key" }, 400);
  const rows = await env.DB.prepare(
    `SELECT q, min_price AS minPrice, max_price AS maxPrice, sort, platforms, city, created_at AS createdAt
     FROM searches WHERE user_key = ? ORDER BY id DESC LIMIT 12`
  ).bind(key).all();
  return json({ items: rows.results || [] });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type, x-user-key",
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        },
      });
    }
    try {
      if (url.pathname === "/api/search") return await search(request, env);
      if (url.pathname === "/api/favorites") return await favorites(request, env);
      if (url.pathname.startsWith("/api/favorites/")) {
        return await favorites(request, env, decodeURIComponent(url.pathname.slice("/api/favorites/".length)));
      }
      if (url.pathname === "/api/searches") return await searches(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "search_failed" }, 500);
    }
  },
};
