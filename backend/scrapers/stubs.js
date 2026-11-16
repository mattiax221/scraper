/**
 * Fake normalized listings. Not real Subito, Vinted, or eBay scrapers.
 * Each function returns a Promise of items shaped as:
 * { id, platform, title, price, currency, image, url, location, date }
 */

function item({ id, platform, title, price, image, url, location, date }) {
  return {
    id,
    platform,
    title,
    price,
    currency: 'EUR',
    image,
    url,
    location,
    date,
  };
}

async function searchSubito(q) {
  const term = q || 'listing';
  return [
    item({
      id: 'subito-1',
      platform: 'subito',
      title: `Wool coat (${term})`,
      price: 45,
      image: 'https://example.com/images/subito-1.jpg',
      url: 'https://example.com/subito/1',
      location: 'Milano',
      date: '2026-11-02T09:00:00.000Z',
    }),
    item({
      id: 'subito-2',
      platform: 'subito',
      title: `Denim jacket (${term})`,
      price: 90,
      image: 'https://example.com/images/subito-2.jpg',
      url: 'https://example.com/subito/2',
      location: 'Torino',
      date: '2026-11-04T14:30:00.000Z',
    }),
    item({
      id: 'subito-3',
      platform: 'subito',
      title: `Rain shell (${term})`,
      price: 18,
      image: 'https://example.com/images/subito-3.jpg',
      url: 'https://example.com/subito/3',
      location: 'Bologna',
      date: '2026-10-28T11:15:00.000Z',
    }),
  ];
}

async function searchVinted(q) {
  const term = q || 'listing';
  return [
    item({
      id: 'vinted-1',
      platform: 'vinted',
      title: `Knit sweater (${term})`,
      price: 30,
      image: 'https://example.com/images/vinted-1.jpg',
      url: 'https://example.com/vinted/1',
      location: 'Roma',
      date: '2026-11-06T08:20:00.000Z',
    }),
    item({
      id: 'vinted-2',
      platform: 'vinted',
      title: `Leather boots (${term})`,
      price: 75,
      image: 'https://example.com/images/vinted-2.jpg',
      url: 'https://example.com/vinted/2',
      location: 'Firenze',
      date: '2026-11-01T16:45:00.000Z',
    }),
    item({
      id: 'vinted-3',
      platform: 'vinted',
      title: `Cotton scarf (${term})`,
      price: 12,
      image: 'https://example.com/images/vinted-3.jpg',
      url: 'https://example.com/vinted/3',
      location: 'Napoli',
      date: '2026-10-30T12:00:00.000Z',
    }),
  ];
}

async function searchEbay(q) {
  const term = q || 'listing';
  return [
    item({
      id: 'ebay-1',
      platform: 'ebay',
      title: `Field jacket (${term})`,
      price: 25,
      image: 'https://example.com/images/ebay-1.jpg',
      url: 'https://example.com/ebay/1',
      location: 'Berlin',
      date: '2026-11-08T10:05:00.000Z',
    }),
    item({
      id: 'ebay-2',
      platform: 'ebay',
      title: `Down parka (${term})`,
      price: 110,
      image: 'https://example.com/images/ebay-2.jpg',
      url: 'https://example.com/ebay/2',
      location: 'Hamburg',
      date: '2026-11-03T18:40:00.000Z',
    }),
    item({
      id: 'ebay-3',
      platform: 'ebay',
      title: `Vintage coat (${term})`,
      price: 200,
      image: 'https://example.com/images/ebay-3.jpg',
      url: 'https://example.com/ebay/3',
      location: 'Munich',
      date: '2026-10-22T07:55:00.000Z',
    }),
  ];
}

module.exports = {
  searchSubito,
  searchVinted,
  searchEbay,
};
