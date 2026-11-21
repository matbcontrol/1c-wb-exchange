// Мок API Wildberries для автотестов обмена. Без зависимостей, Node 18+.
// Повторяет форматы из документации dev.wildberries.ru (OpenAPI, ноябрь 2026) и настоящие
// ответы API на запросы без токена. Обслуживает оба хоста сразу: marketplace-api и content-api.
//
//   node tools/wb-mock.js [--port 8471] [--data samples/gen/wb_fixtures.json] [--limits]
//
// Управление для тестов (без авторизации):
//   POST /__mock/reset            вернуть данные из файла и очистить журнал
//   POST /__mock/fault            добавить сбой: {method, path, status, times, headers, body, mode}
//                                 mode "silent204": PUT остатков отвечает 204, но ничего не меняет
//   POST /__mock/limits           включить или выключить лимиты WB: {"enabled": true}
//   POST /__mock/status           задать статусы заданий: {"<id>": {"supplierStatus": "cancel"}}
//   POST /__mock/orders/generate  добавить N новых заданий: {"count": 300}
//   GET  /__mock/log              журнал запросов; ?clear=1 очищает
//   GET  /__mock/stocks           остатки на складах
//   POST /__mock/shutdown         остановить мок
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('--port', 8471));
const DATA = path.resolve(arg('--data', path.join(__dirname, '..', 'samples', 'gen', 'wb_fixtures.json')));

let db, log, faults, limitsOn;
// Номера сгенерированных заданий растут и после /__mock/reset, как у настоящего WB:
// задание с тем же номером в 1С уже может быть загружено.
let lastGeneratedId = 0;
function reset() {
  db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  log = [];
  faults = [];
  limitsOn = process.argv.includes('--limits');
  buckets.clear();
}

// ---------- Лимиты: корзина токенов на группу методов, как в таблицах документации
const GROUPS = {
  marketplace: { perMin: 300, burst: 20 },
  content: { perMin: 80, burst: 5 },
};
const buckets = new Map();
function takeToken(group, cost) {
  const g = GROUPS[group];
  const now = Date.now();
  let b = buckets.get(group);
  if (!b) { b = { tokens: g.burst, t: now }; buckets.set(group, b); }
  const rate = g.perMin / 60000;
  b.tokens = Math.min(g.burst, b.tokens + (now - b.t) * rate);
  b.t = now;
  const headers = { 'X-Ratelimit-Limit': String(g.burst) };
  if (b.tokens < 1) {
    headers['X-Ratelimit-Retry'] = String(Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000)));
    headers['X-Ratelimit-Reset'] = String(Math.ceil((g.burst - b.tokens) / rate / 1000));
    return { ok: false, headers };
  }
  b.tokens -= cost;
  headers['X-Ratelimit-Remaining'] = String(Math.max(0, Math.floor(b.tokens)));
  return { ok: true, headers };
}

// ---------- Ответы об ошибках в формате WB
const reqId = () => crypto.randomBytes(16).toString('hex');
const problem = (status, title, detail, origin) => ({
  status, statusText: { 401: 'Unauthorized', 403: 'Forbidden', 429: 'Too Many Requests' }[status] || '', title, detail,
  requestId: reqId(), origin, timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
});
const err = (code, message) => ({ code, message });

function send(res, status, body, headers = {}, type) {
  const h = { ...headers };
  let payload = '';
  if (body !== undefined && body !== null && status !== 204) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    h['Content-Type'] = type || 'application/json; charset=utf-8';
  }
  res.writeHead(status, h);
  res.end(payload);
  return status;
}

// ---------- Авторизация: как отвечает настоящий API
function auth(req, group) {
  const origin = group === 'content' ? 'ag-content' : 'ag-marketplace';
  const token = (req.headers.authorization || '').trim();
  if (!token) return problem(401, 'Unauthorized', 'invalid API access token: empty main token', origin);
  if (token.split('.').length !== 3) return problem(401, 'Unauthorized', 'invalid API access token: token is malformed: token contains an invalid number of segments', origin);
  if (token === db.contentOnlyToken && group === 'marketplace') return problem(403, 'Forbidden', 'scope is not allowed for this resource', origin);
  if (token !== db.token && token !== db.contentOnlyToken) return problem(401, 'Unauthorized', 'invalid API access token: token signature is invalid', origin);
  return null;
}

// ---------- Маршруты API
const isInt = (v) => Number.isInteger(v);

function cardsList(body) {
  const s = (body && body.settings) || {};
  const cur = s.cursor || {};
  const limit = cur.limit === undefined ? 10 : cur.limit;
  if (!isInt(limit) || limit < 1 || limit > 100) return [400, { title: 'Validation error', detail: 'cursor.limit must be in range 1..100', status: 400 }];
  const asc = s.sort && s.sort.ascending === true;
  let list = db.cards.slice().sort((a, b) => (a.updatedAt === b.updatedAt ? a.nmID - b.nmID : a.updatedAt < b.updatedAt ? -1 : 1));
  if (!asc) list.reverse();
  if (cur.updatedAt && cur.nmID) {
    const i = list.findIndex((c) => c.updatedAt === cur.updatedAt && c.nmID === cur.nmID);
    list = i >= 0 ? list.slice(i + 1) : [];
  }
  const page = list.slice(0, limit);
  const last = page[page.length - 1];
  return [200, { cards: page, cursor: { updatedAt: last ? last.updatedAt : cur.updatedAt, nmID: last ? last.nmID : cur.nmID, total: page.length } }];
}

function stocksGet(wh, body) {
  if (!db.warehouses.find((w) => w.id === wh)) return [404, err('NotFound', 'Not found')];
  if (body && body.skus) return [400, err('SKUUploadDisabled', "Uploading stock is not allowed by 'sku'. Please use the 'chrtId' key")];
  if (!body || !Array.isArray(body.chrtIds) || body.chrtIds.length > 1000 || !body.chrtIds.every(isInt)) return [400, err('IncorrectRequestBody', 'Incorrect required body')];
  const st = db.stocks[wh] || {};
  return [200, { stocks: body.chrtIds.filter((id) => st[id] !== undefined).map((id) => ({ chrtId: id, amount: st[id] })) }];
}

function stocksPut(wh, body, silent) {
  const w = db.warehouses.find((x) => x.id === wh);
  if (!w) return [404, err('NotFound', 'Not found')];
  if (!body || !Array.isArray(body.stocks) || body.stocks.length < 1 || body.stocks.length > 1000) return [400, err('IncorrectRequestBody', 'Incorrect required body')];
  if (body.stocks.some((s) => s && s.sku !== undefined)) return [400, err('SKUUploadDisabled', "Uploading stock is not allowed by 'sku'. Please use the 'chrtId' key")];
  // Как в документации: названия полей не проверяются, неверное имя даёт 204 без изменений.
  if (silent || body.stocks.some((s) => !s || s.chrtId === undefined)) return [204];
  if (!body.stocks.every((s) => isInt(s.chrtId) && isInt(s.amount) && s.amount >= 0)) return [400, err('IncorrectParameter', 'Incorrect parameter')];
  const known = new Set(db.cards.flatMap((c) => c.sizes.map((z) => z.chrtID)));
  const problems = {};
  const add = (code, message, s) => { (problems[code] = problems[code] || { code, message, data: [] }).data.push({ sku: '', chrtId: s.chrtId, amount: s.amount }); };
  const st = db.stocks[wh] = db.stocks[wh] || {};
  for (const s of body.stocks) {
    if (w.deliveryType !== 1) add('DeliveryTypeRestriction', 'The warehouse delivery type does not allow this product', s);
    else if (!known.has(s.chrtId)) add('NotFound', 'Not found', s);
    else if (db.restricted.includes(s.chrtId)) add('SubjectRestriction', "The product category cannot be sold with 'Fulfillment By Seller'", s);
    else if (s.amount > 100000) add('UploadDataLimit', 'Upload limit exceeded.', s);
    else st[s.chrtId] = s.amount;
  }
  const list = Object.values(problems);
  return list.length ? [409, list] : [204];
}

function ordersList(q) {
  const limit = Number(q.get('limit'));
  const next = q.get('next');
  if (!q.has('limit') || !isInt(limit) || limit < 1 || limit > 1000 || next === null || !/^\d+$/.test(next)) return [400, err('IncorrectParameter', 'Incorrect parameter')];
  const nowSec = Math.floor(Date.now() / 1000);
  const from = q.has('dateFrom') ? Number(q.get('dateFrom')) : nowSec - 30 * 86400;
  const to = q.has('dateTo') ? Number(q.get('dateTo')) : nowSec;
  if (to - from > 30 * 86400 + 1 || to < from) return [400, err('IncorrectParameter', 'Incorrect parameter')];
  const list = db.orders
    .filter((o) => { const t = Date.parse(o.createdAt) / 1000; return t >= from && t <= to && o.id > Number(next); })
    .sort((a, b) => a.id - b.id).slice(0, limit)
    .map(({ ddate, sellerDate, salePrice, requiredMeta, optionalMeta, finalPrice, convertedFinalPrice, isPickupPointShipmentAllowed, ...o }) => o);
  return [200, { next: list.length ? list[list.length - 1].id : Number(next), orders: list }];
}

function ordersNew() {
  const list = db.orders.filter((o) => (db.statuses[o.id] || {}).supplierStatus === 'new' && (db.statuses[o.id] || {}).wbStatus === 'waiting');
  return [200, { orders: list }];
}

function ordersStatus(body) {
  if (!body || !Array.isArray(body.orders) || body.orders.length < 1 || body.orders.length > 1000 || !body.orders.every(isInt)) return [400, err('IncorrectRequestBody', 'Incorrect required body')];
  const known = new Map(db.orders.map((o) => [o.id, o]));
  return [200, { orders: body.orders.filter((id) => known.has(id)).map((id) => {
    const s = db.statuses[id] || { supplierStatus: 'new', wbStatus: 'waiting' };
    return { id, supplierStatus: s.supplierStatus, wbStatus: s.wbStatus, isCancellable: s.supplierStatus === 'new', isTransferable: false };
  }) }];
}

function generateOrders(count) {
  const sellable = db.cards.filter((c) => !db.restricted.includes(c.sizes[0].chrtID) && c.sizes.length === 1 && /^\d+$/.test(c.vendorCode));
  let id = Math.max(lastGeneratedId, ...db.orders.map((o) => o.id)) + 3;
  for (let n = 0; n < count; n++) {
    const c = sellable[n % sellable.length];
    const price = 10000 + ((n * 7919) % 90000);
    db.orders.push({
      address: null, deliveryType: 'fbs', comment: '', scanPrice: null, orderUid: `gen_${n}`, article: c.vendorCode, colorCode: '', rid: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date(Date.now() - (n % 300) * 60000).toISOString().replace(/\.\d+Z$/, 'Z'), offices: ['Подольск'], skus: c.sizes[0].skus, id, warehouseId: 507001, officeId: 15,
      nmId: c.nmID, chrtId: c.sizes[0].chrtID, price, finalPrice: price, convertedPrice: price, convertedFinalPrice: price, currencyCode: 643, convertedCurrencyCode: 643,
      cargoType: 1, crossBorderType: 0, isZeroOrder: false, isPickupPointShipmentAllowed: true, options: { isB2B: false },
    });
    db.statuses[id] = { supplierStatus: 'new', wbStatus: 'waiting' };
    lastGeneratedId = id;
    id += 3;
  }
  return count;
}

// ---------- Сервер
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const raw = await readBody(req);
  let body;
  try { body = raw ? JSON.parse(raw) : undefined; } catch (e) { body = Symbol('bad'); }
  const started = Date.now();
  const entry = { t: started, method: req.method, path: p, query: url.search, body: raw.length > 20000 ? raw.slice(0, 20000) : raw, auth: !!req.headers.authorization };

  // Управление моком
  if (p.startsWith('/__mock/')) {
    if (p === '/__mock/reset') { reset(); return send(res, 200, { ok: true }); }
    if (p === '/__mock/shutdown') { send(res, 200, { ok: true }); server.close(); setTimeout(() => process.exit(0), 50); return; }
    if (p === '/__mock/fault') { faults.push({ times: 1, ...body }); return send(res, 200, { ok: true, faults: faults.length }); }
    if (p === '/__mock/limits') { limitsOn = !!(body && body.enabled); buckets.clear(); return send(res, 200, { ok: true, limits: limitsOn }); }
    if (p === '/__mock/status') { for (const [id, s] of Object.entries(body || {})) db.statuses[id] = { ...(db.statuses[id] || {}), ...s }; return send(res, 200, { ok: true }); }
    if (p === '/__mock/orders/generate') return send(res, 200, { ok: true, added: generateOrders(Number(body && body.count) || 0) });
    if (p === '/__mock/stocks') return send(res, 200, db.stocks);
    if (p === '/__mock/log') { const out = log.slice(); if (url.searchParams.get('clear')) log = []; return send(res, 200, out); }
    return send(res, 404, { error: 'unknown mock command' });
  }

  const group = p.startsWith('/content/') ? 'content' : 'marketplace';
  const finish = (status, out, headers, type) => { entry.status = status; entry.ms = Date.now() - started; log.push(entry); return send(res, status, out, headers, type); };

  // Сбои, заданные тестом
  const fault = faults.find((f) => f.times > 0 && (!f.method || f.method === req.method) && (!f.path || p.startsWith(f.path)));
  let silent = false;
  if (fault) {
    fault.times--;
    if (fault.mode === 'silent204') silent = true;
    else {
      const type = fault.status === 429 || fault.status === 401 ? 'application/problem+json' : undefined;
      let out = fault.body;
      if (out === undefined && fault.status === 429) out = problem(429, 'too many requests', 'limited by c122a060-a7fb-4bb4-abb0-32fd4e18d489', group === 'content' ? 'ag-content' : 'ag-marketplace');
      if (out === undefined && fault.status >= 500) out = 'Internal Server Error';
      return finish(fault.status, out, fault.headers || {}, type || (typeof out === 'string' ? 'text/plain' : undefined));
    }
  }

  const denied = auth(req, group);
  if (denied) return finish(denied.status, denied, {}, 'application/problem+json');

  let rl = { ok: true, headers: {} };
  if (limitsOn) {
    rl = takeToken(group, 1);
    if (!rl.ok) return finish(429, problem(429, 'too many requests', 'limited by c122a060-a7fb-4bb4-abb0-32fd4e18d489', group === 'content' ? 'ag-content' : 'ag-marketplace'), rl.headers, 'application/problem+json');
  }
  if (typeof body === 'symbol') return finish(400, err('IncorrectRequestBody', 'Incorrect required body'), rl.headers);

  let r;
  const m = p.match(/^\/api\/v3\/stocks\/(\d+)$/);
  if (req.method === 'GET' && p === '/ping') r = [200, { TS: new Date().toISOString(), Status: 'OK' }];
  else if (req.method === 'GET' && p === '/api/v3/warehouses') r = [200, db.warehouses];
  else if (req.method === 'POST' && p === '/content/v2/get/cards/list') r = cardsList(body);
  else if (m && req.method === 'POST') r = stocksGet(Number(m[1]), body);
  else if (m && req.method === 'PUT') r = stocksPut(Number(m[1]), body, silent);
  else if (req.method === 'GET' && p === '/api/v3/orders/new') r = ordersNew();
  else if (req.method === 'GET' && p === '/api/v3/orders') r = ordersList(url.searchParams);
  else if (req.method === 'POST' && p === '/api/v3/orders/status') r = ordersStatus(body);
  else r = [404, err('NotFound', 'Not found')];

  // 4XX у Маркетплейса стоит как 10 запросов
  if (limitsOn && group === 'marketplace' && r[0] >= 400 && r[0] < 500) takeToken(group, 9);
  return finish(r[0], r[1], rl.headers);
});

reset();
server.listen(PORT, '127.0.0.1', () => console.log(`WB mock on http://127.0.0.1:${PORT}, data ${DATA}, limits ${limitsOn}`));
