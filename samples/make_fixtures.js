// Строит данные мока Wildberries и ожидаемые результаты тестов из выгрузки демобазы УНФ.
//   samples/demo_goods.tsv  товары склада «Хозяйственные товары»: артикул, свободный остаток, цена, штрихкоды
//   samples/gen/wb_fixtures.json  склады, карточки, остатки на WB, сборочные задания
//   samples/gen/expected.json     что должны получить тесты; считается здесь, без кода обработки
// Запуск из папки проекта: node samples/make_fixtures.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const out = path.join(root, 'gen');
fs.mkdirSync(out, { recursive: true });

// Детерминированный генератор, чтобы данные не менялись от запуска к запуску.
let seed = 20261120;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');

function ean13(body12) {
  const d = body12.split('').map(Number);
  const sum = d.reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
  return body12 + ((10 - (sum % 10)) % 10);
}

// ---------- Товары демобазы
const lines = fs.readFileSync(path.join(root, 'demo_goods.tsv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const head = lines.find((l) => l.startsWith('uuid')).split('\t');
const isCharLine = (l) => l.startsWith('#хар\t');
const meta = Object.fromEntries(lines.filter((l) => l.startsWith('#') && !isCharLine(l)).map((l) => { const p = l.split('\t'); return [p[0].slice(1), p[1]]; }));
const goods = lines.filter((l) => !l.startsWith('#') && !l.startsWith('uuid') && !l.startsWith('--'))
  .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])))
  .map((g) => ({ ...g, free: Number(g.free), retail: Number(g.retail), barcodes: g.barcodes ? g.barcodes.split(',') : [] }));
// Характеристики (#хар: товар, характеристика, наименование, свободный остаток). У таких товаров
// остаток и заказ в УНФ ведутся по характеристике, без неё заказ не проводится.
const charsOf = {};
lines.filter(isCharLine).forEach((l) => {
  const p = l.split('\t');
  (charsOf[p[1]] = charsOf[p[1]] || []).push({ uuid: p[2], name: p[3], free: Number(p[4]) });
});

const withArticle = goods.filter((g) => g.article && g.articleCount === '1' && !charsOf[g.uuid])
  .sort((a, b) => a.article.localeCompare(b.article, 'ru', { numeric: true }));
const withBarcode = goods.filter((g) => g.barcodes.length > 0 && !charsOf[g.uuid]);

// ---------- Настройки, с которыми тесты считают остатки
const settings = { warehouseId: 507001, safetyStock: 1, percent: 100 };
const toUpload = (free) => Math.max(0, Math.min(100000, Math.floor(free * settings.percent / 100) - settings.safetyStock));

// ---------- Склады продавца на WB
const warehouses = [
  { name: 'Склад продавца, Подольск (FBS)', officeId: 15, id: 507001, cargoType: 1, deliveryType: 1, isDeleting: false, isProcessing: false },
  { name: 'Склад продавца, самовывоз (DBS)', officeId: 15, id: 507002, cargoType: 1, deliveryType: 2, isDeleting: false, isProcessing: false },
];

// ---------- Карточки товаров
const baseTime = Date.parse('2026-11-01T09:00:00.000Z');
const cards = [];
let wbBarcode = 204100000000;
const newCard = (i, vendorCode, title, subjectName, sizes, extra = {}) => {
  const card = {
    nmID: 145000000 + i * 17, imtID: 98000000 + i * 5, nmUUID: `01bda0b1-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`,
    subjectID: 3000 + (i % 7), subjectName, vendorCode, brand: 'Хозтовары', title: title.slice(0, 60), description: '', needKiz: false,
    photos: [], video: '', dimensions: { length: 30, width: 20, height: 10, weightBrutto: 1.2, isValid: true },
    characteristics: [], sizes, tags: [],
    createdAt: new Date(baseTime - 86400000 * 30).toISOString(), updatedAt: new Date(baseTime + i * 61000).toISOString(),
    ...extra,
  };
  cards.push(card);
  return card;
};
const size = (chrtID, techSize, skus) => ({ chrtID, techSize, wbSize: techSize === '0' ? '' : techSize, skus });
const wbSku = () => ean13(String(wbBarcode++));

// 64 обычные карточки: артикул продавца совпадает с артикулом в 1С, штрихкод сгенерирован WB.
const mapped = [];
for (let i = 0; i < 64; i++) {
  const g = withArticle[i];
  const c = newCard(i, g.article, g.name, g.group, [size(31700000 + i * 13, '0', [wbSku()])]);
  mapped.push({ card: c, good: g, how: 'артикул' });
}
// Две карточки находятся по штрихкоду: артикул на WB свой, а штрихкод заведён в 1С.
const byBarcode = withBarcode.slice(0, 2);
byBarcode.forEach((g, k) => {
  const c = newCard(64 + k, `WB-${(g.article || g.name).replace(/[^0-9A-Za-zА-Яа-я]+/g, '').slice(0, 10).toUpperCase()}-${k + 1}`, g.name, g.group,
    [size(31710000 + k * 13, '0', [g.barcodes[0]])]);
  mapped.push({ card: c, good: g, how: 'штрихкод' });
});
// Две карточки, которых нет в 1С.
newCard(66, 'BRISKO-X1', 'Ведро с отжимом BRISKO X1, 10 л', 'Ведра', [size(31720000, '0', [wbSku()])]);
newCard(67, 'TAZ-DEMO-35', 'Таз пластиковый 35 л', 'Тазы', [size(31720013, '0', [wbSku()])]);
// Карточка с двумя размерами: артикул есть в 1С, но остаток нельзя разложить по размерам без штрихкодов.
const multiGood = withArticle[64];
newCard(68, multiGood.article, multiGood.name, multiGood.group, [size(31730000, 'S', [wbSku()]), size(31730013, 'M', [wbSku()])]);
// Карточка, которую нельзя продавать по FBS: WB отвечает 409 SubjectRestriction.
const restrictedGood = withArticle[65];
const restrictedCard = newCard(69, restrictedGood.article, restrictedGood.name, restrictedGood.group, [size(31740000, '0', [wbSku()])]);
const restrictedEntry = { card: restrictedCard, good: restrictedGood, how: 'артикул', restricted: true };
mapped.push(restrictedEntry);
// Товар с характеристиками (перчатки S, L, XL): на WB карточка с тремя размерами. По артикулу размер
// не определить, поэтому размеры сопоставляются по штрихкодам WB, которые продавец заводит на
// характеристики в 1С. Тесты сначала проверяют подсказку без штрихкодов, потом заводят их сами.
const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const charGood = goods.find((g) => charsOf[g.uuid]);
const charList = charsOf[charGood.uuid].slice().sort((a, b) => sizeOrder.indexOf(a.name) - sizeOrder.indexOf(b.name));
const charCard = newCard(70, charGood.article, charGood.name, charGood.group, charList.map((c, k) => size(31750000 + k * 13, c.name, [wbSku()])));
const charEntries = charList.map((c, k) => ({ card: charCard, sizeIdx: k, good: charGood, how: 'штрихкод', char: c }));
mapped.push(...charEntries);

const sizeOf = (m) => m.card.sizes[m.sizeIdx || 0];
const freeOf = (m) => (m.char ? m.char.free : Number(m.good.free));
const keyOf = (m) => m.good.uuid + (m.char ? '|' + m.char.uuid : '');

// ---------- Остатки, которые уже стоят на WB (склад 507001)
const stocks = {};
const wbStock = stocks[settings.warehouseId] = {};
mapped.forEach((m, i) => {
  const chrt = sizeOf(m).chrtID;
  const want = toUpload(freeOf(m));
  if (i % 4 === 0) wbStock[chrt] = want;          // уже совпадает
  else if (i % 4 === 1) wbStock[chrt] = want + 5;  // на WB больше, надо уменьшить
  else if (i % 4 === 2) wbStock[chrt] = 0;          // на WB ноль
  // i % 4 === 3: записи нет, считается ноль
});

// ---------- Сборочные задания
const now = Date.parse('2026-11-20T09:00:00.000Z');
let orderId = 3100000001;
const orders = [];
const basket = () => `165918930_${hex(32)}`;
const newOrder = (m, o = {}) => {
  const g = m.good;
  // У части товаров демобазы нет розничной цены: берём правдоподобную цену хозтовара.
  const retail = g.retail > 0 ? g.retail : 190 + Math.floor(rnd() * 600);
  const k = 0.75 + rnd() * 0.2;
  const rub = Math.round(retail * k * 100);
  const sizeIdx = o.sizeIdx !== undefined ? o.sizeIdx : (m.sizeIdx || 0);
  const ord = {
    address: null, ddate: '', sellerDate: '25.11.2026', salePrice: Math.round(retail * 100), requiredMeta: [], optionalMeta: [],
    deliveryType: 'fbs', comment: o.comment || '', scanPrice: null, orderUid: o.orderUid || basket(),
    article: o.article !== undefined ? o.article : m.card.vendorCode, colorCode: '', rid: hex(32),
    createdAt: new Date(o.created || (now - Math.floor(rnd() * 600) * 60000)).toISOString().replace('.000Z', 'Z'), offices: ['Подольск'],
    skus: o.skus || m.card.sizes[sizeIdx].skus, id: orderId, warehouseId: settings.warehouseId, officeId: 15,
    nmId: m.card.nmID, chrtId: m.card.sizes[sizeIdx].chrtID,
    price: o.price !== undefined ? o.price : rub, finalPrice: rub, convertedPrice: rub, convertedFinalPrice: rub,
    currencyCode: o.currencyCode || 643, convertedCurrencyCode: 643, cargoType: 1, crossBorderType: 0,
    isZeroOrder: !!o.isZeroOrder, isPickupPointShipmentAllowed: true, options: { isB2B: false },
  };
  orderId += 3;
  orders.push({ order: ord, mappedTo: o.notFound ? null : g, entry: m, how: o.how || m.how, status: o.status || { supplierStatus: 'new', wbStatus: 'waiting' } });
  return ord;
};

// Новые задания (24 шт.)
const sameBasket = basket();
[0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].forEach((i, n) =>
  newOrder(mapped[i], { orderUid: n < 2 ? sameBasket : undefined, comment: n === 4 ? 'Упакуйте в плёнку, пожалуйста' : '' }));
newOrder(mapped[64], { article: mapped[64].card.vendorCode, how: 'штрихкод' });                  // по штрихкоду
newOrder(mapped[0], { article: 'UNKNOWN-777', skus: [ean13('204999999999')], notFound: true, how: '' }); // товара нет в 1С
newOrder(mapped[16], { isZeroOrder: true });                                                      // заказ при нулевом остатке на WB
const byn = newOrder(mapped[17], { currencyCode: 933 });                                          // продажа в BYN
byn.price = Math.round(byn.convertedPrice / 28); byn.finalPrice = byn.price;
newOrder({ card: cards[68], good: multiGood, how: 'артикул' });                                    // товар с размерами на WB
newOrder(restrictedEntry);                                                                        // товар с ограничением FBS
const charOrderEntry = charEntries.find((e) => e.char.name === 'XL') || charEntries[charEntries.length - 1];
const charOrder = newOrder(charOrderEntry);                                                       // перчатки XL: по штрихкоду характеристики
const newOrders = orders.slice();

// Старые задания за прошлую неделю (16 шт.): уже на сборке или доставлены.
for (let n = 0; n < 16; n++) {
  newOrder(mapped[20 + n], { created: now - (2 + (n % 7)) * 86400000 - n * 3600000, status: n % 2 ? { supplierStatus: 'complete', wbStatus: 'sold' } : { supplierStatus: 'confirm', wbStatus: 'sorted' } });
}

// ---------- Ожидаемые результаты
const isNew = (o) => newOrders.includes(o);
const created = newOrders.filter((o) => o.mappedTo);
// Резерв как в обработке: по одному на заказ, пока есть свободный остаток; без остатка заказ
// создаётся без резерва.
const freeLeft = {};
const takeOne = (pool, m) => {
  const k = keyOf(m);
  if (pool[k] === undefined) pool[k] = freeOf(m);
  if (pool[k] >= 1) { pool[k] -= 1; return true; }
  return false;
};
const reserveBy = {};
created.forEach((o) => {
  o.reserved = takeOne(freeLeft, o.entry);
  if (o.reserved) reserveBy[keyOf(o.entry)] = (reserveBy[keyOf(o.entry)] || 0) + 1;
});

const stockRows = (reserved) => mapped.map((m) => {
  const chrt = sizeOf(m).chrtID;
  const free = freeOf(m) - (reserved[keyOf(m)] || 0);
  const want = toUpload(free);
  const onWb = wbStock[chrt] !== undefined ? wbStock[chrt] : 0;
  return { chrtId: chrt, uuid: m.good.uuid, charUuid: m.char ? m.char.uuid : '', article: m.card.vendorCode, how: m.how, free, want, onWb, restricted: !!m.restricted };
});
const summary = (rows) => ({
  mapped: rows.length,
  changed: rows.filter((r) => r.want !== r.onWb).length,
  unchanged: rows.filter((r) => r.want === r.onWb).length,
  restrictedChanged: rows.filter((r) => r.restricted && r.want !== r.onWb).length,
  totalWant: rows.reduce((s, r) => s + r.want, 0),
});
const before = stockRows({});
const after = stockRows(reserveBy);

// Объёмный тест: мок по /__mock/orders/generate раздаёт задания по карточкам с одним размером и
// цифровым артикулом (без запрещённой). К этому моменту в базе 24 заказа, два из них отменены.
const volumePool = { ...freeLeft };
[newOrders[5], newOrders[6]].forEach((o) => { if (o.reserved) volumePool[keyOf(o.entry)] += 1; });
const sellable = cards.filter((c) => c.sizes[0].chrtID !== restrictedCard.sizes[0].chrtID && c.sizes.length === 1 && /^\d+$/.test(c.vendorCode));
const noReserveAmong = (count) => {
  const pool = { ...volumePool };
  let none = 0;
  for (let n = 0; n < count; n++) {
    const m = mapped.find((e) => e.card === sellable[n % sellable.length]);
    if (!takeOne(pool, m)) none++;
  }
  return none;
};

const expected = {
  settings,
  meta,
  cards: {
    total: cards.length,
    sizes: cards.reduce((s, c) => s + c.sizes.length, 0),
    byArticle: mapped.filter((m) => m.how === 'артикул').length,
    byBarcode: mapped.filter((m) => m.how === 'штрихкод').length,
    notMapped: 2 + 2, // две карточки без пары в 1С и два размера карточки с размерами
    multiSizeVendorCode: cards[68].vendorCode,
    restrictedChrtId: restrictedCard.sizes[0].chrtID,
  },
  orders: {
    newTotal: newOrders.length,
    created: created.length,
    byArticle: created.filter((o) => o.how === 'артикул').length,
    byBarcode: created.filter((o) => o.how === 'штрихкод').length,
    notFound: newOrders.filter((o) => !o.mappedTo).length,
    notFoundId: newOrders.find((o) => !o.mappedTo).order.id,
    zeroOrderId: newOrders.find((o) => o.order.isZeroOrder).order.id,
    bynOrderId: byn.id,
    bynPriceRub: byn.convertedPrice / 100,
    sampleId: newOrders[4].order.id,
    sampleUuid: newOrders[4].mappedTo.uuid,
    samplePriceRub: newOrders[4].order.convertedPrice / 100,
    sampleComment: newOrders[4].order.comment,
    sumRub: created.reduce((s, o) => s + o.order.convertedPrice, 0) / 100,
    noReserve: created.filter((o) => !o.reserved).length,
    periodTotal: orders.length,
    cancelBySeller: newOrders[5].order.id,   // супплаер отменил
    cancelByClient: newOrders[6].order.id,   // покупатель отказался
    cancelUuids: [newOrders[5].mappedTo.uuid, newOrders[6].mappedTo.uuid],
    reserveBy: Object.entries(reserveBy).map(([key, qty]) => ({ uuid: key.split('|')[0], charUuid: key.split('|')[1] || '', qty })),
    periodFrom: '2026-11-10', periodTo: '2026-11-21',
  },
  chars: {
    goodUuid: charGood.uuid,
    vendorCode: charCard.vendorCode,
    orderId: charOrder.id,
    orderCharUuid: charOrderEntry.char.uuid,
    rows: charEntries.map((e) => ({ chrtId: sizeOf(e).chrtID, barcode: sizeOf(e).skus[0], charUuid: e.char.uuid, charName: e.char.name, free: e.char.free, want: toUpload(e.char.free) })),
  },
  volume: { generated: 300, createDefault: 20, noReserveDefault: noReserveAmong(20), noReserveFull: noReserveAmong(300) },
  tokens: { token: null, contentOnlyToken: null },
  stocksBefore: { ...summary(before), rows: before },
  stocksAfter: { ...summary(after), rows: after },
};

const fixtures = {
  token: 'eyJhbGciOiJFUzI1NiJ9.eyJzY29wZSI6Im1vY2sifQ.bW9jay1zaWduYXR1cmU',
  contentOnlyToken: 'eyJhbGciOiJFUzI1NiJ9.eyJzY29wZSI6ImNvbnRlbnQifQ.Y29udGVudC1vbmx5',
  warehouses, cards, stocks,
  restricted: [restrictedCard.sizes[0].chrtID],
  orders: orders.map((o) => o.order),
  statuses: Object.fromEntries(orders.map((o) => [o.order.id, o.status])),
};

expected.tokens = { token: fixtures.token, contentOnlyToken: fixtures.contentOnlyToken };
fs.writeFileSync(path.join(out, 'wb_fixtures.json'), JSON.stringify(fixtures, null, 1));
fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(expected, null, 1));
console.log(`карточек ${cards.length}, размеров ${expected.cards.sizes}, новых заданий ${newOrders.length}, всего заданий ${orders.length}`);
console.log(`остатки до заказов: изменить ${expected.stocksBefore.changed}, без изменений ${expected.stocksBefore.unchanged}; после заказов: изменить ${expected.stocksAfter.changed}`);
console.log(`заказы: создать ${expected.orders.created} (артикул ${expected.orders.byArticle}, штрихкод ${expected.orders.byBarcode}), не найдено ${expected.orders.notFound}, сумма ${expected.orders.sumRub}`);
