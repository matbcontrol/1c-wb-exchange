// Генерирует Form.xml формы обработки «Обмен с Wildberries».
// Запуск: node tools/build_form_wb.js src/ОбменWildberries/Forms/Форма/Ext/Form.xml
const fs = require('fs');

let id = 0;
const next = () => ++id;
const ru = (t) => `<v8:item><v8:lang>ru</v8:lang><v8:content>${t}</v8:content></v8:item>`;
const title = (t) => `<Title>${ru(t)}</Title>`;
const cm = (n) => `<ContextMenu name="${n}КонтекстноеМеню" id="${next()}"/>`;
const tip = (n) => `<ExtendedTooltip name="${n}РасширеннаяПодсказка" id="${next()}"/>`;
const events = (list) => (list && list.length ? `<Events>${list.map(([e, h]) => `<Event name="${e}">${h}</Event>`).join('')}</Events>` : '');

function input(name, path, o = {}) {
  const p = [`<DataPath>${path}</DataPath>`];
  if (o.readOnly) p.push('<ReadOnly>true</ReadOnly>');
  if (o.caption) p.push(title(o.caption));
  if (o.titleLoc) p.push(`<TitleLocation>${o.titleLoc}</TitleLocation>`);
  if (o.width) p.push(`<Width>${o.width}</Width>`);
  if (o.height) p.push(`<Height>${o.height}</Height>`);
  if (o.multiLine) p.push('<MultiLine>true</MultiLine>');
  if (o.hint) p.push(`<InputHint>${ru(o.hint)}</InputHint>`);
  return `<InputField name="${name}" id="${next()}">${p.join('')}${cm(name)}${tip(name)}${events(o.events)}</InputField>`;
}

function checkbox(name, path, o = {}) {
  const p = [`<DataPath>${path}</DataPath>`];
  if (o.caption) p.push(title(o.caption));
  p.push(`<TitleLocation>${o.titleLoc || 'Right'}</TitleLocation>`);
  p.push('<CheckBoxType>Auto</CheckBoxType>');
  return `<CheckBoxField name="${name}" id="${next()}">${p.join('')}${cm(name)}${tip(name)}${events(o.events)}</CheckBoxField>`;
}

function group(name, caption, kind, children, o = {}) {
  return `<UsualGroup name="${name}" id="${next()}">${title(caption)}<Group>${kind}</Group><Representation>${o.repr || 'None'}</Representation><ShowTitle>${o.showTitle ? 'true' : 'false'}</ShowTitle>${tip(name)}<ChildItems>${children.join('')}</ChildItems></UsualGroup>`;
}

function page(name, caption, children) {
  return `<Page name="${name}" id="${next()}">${title(caption)}<Group>Vertical</Group><ShowTitle>true</ShowTitle>${tip(name)}<ChildItems>${children.join('')}</ChildItems></Page>`;
}

function pages(name, children) {
  return `<Pages name="${name}" id="${next()}">${title('Страницы')}<PagesRepresentation>TabsOnTop</PagesRepresentation>${tip(name)}<ChildItems>${children.join('')}</ChildItems></Pages>`;
}

function addition(tableName, kind, suffix) {
  const n = tableName + suffix;
  const type = kind === 'SearchStringAddition' ? 'SearchStringRepresentation' : kind === 'ViewStatusAddition' ? 'ViewStatusRepresentation' : 'SearchControl';
  return `<${kind} name="${n}" id="${next()}"><AdditionSource><Item>${tableName}</Item><Type>${type}</Type></AdditionSource>${cm(n)}${tip(n)}</${kind}>`;
}

function table(name, columns, o = {}) {
  const head = `<Table name="${name}" id="${next()}"><Representation>List</Representation>${o.title ? title(o.title) : ''}<ChangeRowSet>false</ChangeRowSet><ChangeRowOrder>false</ChangeRowOrder>${o.height ? `<Height>${o.height}</Height>` : ''}<DataPath>${name}</DataPath>`;
  const parts = [cm(name), `<AutoCommandBar name="${name}КоманднаяПанель" id="${next()}"/>`, tip(name),
    addition(name, 'SearchStringAddition', 'СтрокаПоиска'),
    addition(name, 'ViewStatusAddition', 'СостояниеПросмотра'),
    addition(name, 'SearchControlAddition', 'УправлениеПоиском')];
  return head + parts.join('') + `<ChildItems>${columns.join('')}</ChildItems></Table>`;
}

function button(name, command, isDefault) {
  return `<Button name="${name}" id="${next()}"><Type>UsualButton</Type>${isDefault ? '<DefaultButton>true</DefaultButton>' : ''}<CommandName>${command}</CommandName>${tip(name)}</Button>`;
}

// Типы.
const str = (len = 0) => `<v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>${len}</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers>`;
const num = (d, f, sign = 'Any') => `<v8:Type>xs:decimal</v8:Type><v8:NumberQualifiers><v8:Digits>${d}</v8:Digits><v8:FractionDigits>${f}</v8:FractionDigits><v8:AllowedSign>${sign}</v8:AllowedSign></v8:NumberQualifiers>`;
const bool = () => '<v8:Type>xs:boolean</v8:Type>';
const date = () => '<v8:Type>xs:dateTime</v8:Type><v8:DateQualifiers><v8:DateFractions>Date</v8:DateFractions></v8:DateQualifiers>';
const dateTime = () => '<v8:Type>xs:dateTime</v8:Type><v8:DateQualifiers><v8:DateFractions>DateTime</v8:DateFractions></v8:DateQualifiers>';
const ref = (t) => `<v8:Type>cfg:${t}</v8:Type>`;

let attrId = 0;
const attr = (name, caption, type, extra = '') => `<Attribute name="${name}" id="${++attrId}">${caption ? title(caption) : ''}<Type>${type}</Type>${extra}</Attribute>`;
let colId = 0;
const valueTable = (name, caption, cols) => `<Attribute name="${name}" id="${++attrId}">${title(caption)}<Type><v8:Type>v8:ValueTable</v8:Type></Type><Columns>${
  cols.map(([n, t]) => `<Column name="${n}" id="${++colId}"><Type>${t}</Type></Column>`).join('')}</Columns></Attribute>`;

// Колонки совпадают с НоваяТаблицаЗаказов, НоваяТаблицаОстатков и НоваяТаблицаСтатусов модуля объекта.
const orderCols = [
  ['Применить', bool()], ['Статус', str(30)], ['ИдЗадания', num(15, 0)], ['Rid', str(64)], ['Корзина', str(100)],
  ['ДатаЗаказа', dateTime()], ['ДатаОтгрузки', dateTime()], ['Артикул', str(100)], ['АртикулWB', num(15, 0)], ['РазмерWB', num(15, 0)],
  ['Штрихкоды', str(200)], ['Цена', num(15, 2)], ['ВалютаПродажи', num(3, 0)], ['СкладWB', num(15, 0)], ['КомментарийПокупателя', str(300)],
  ['НулевойОстаток', bool()], ['Номенклатура', ref('CatalogRef.Номенклатура')], ['Характеристика', ref('CatalogRef.ХарактеристикиНоменклатуры')],
  ['КакНайден', str(20)], ['Заказ1С', ref('DocumentRef.ЗаказПокупателя')], ['Пояснение', str(500)],
];
const stockCols = [
  ['Выгрузить', bool()], ['Статус', str(30)], ['nmID', num(15, 0)], ['chrtID', num(15, 0)], ['АртикулПродавца', str(100)], ['Размер', str(50)],
  ['Наименование', str(250)], ['Штрихкоды', str(200)], ['Номенклатура', ref('CatalogRef.Номенклатура')], ['Характеристика', ref('CatalogRef.ХарактеристикиНоменклатуры')],
  ['КакНайден', str(20)], ['Свободно', num(15, 3)], ['КВыгрузке', num(10, 0)], ['НаWB', num(10, 0)], ['ЕстьНаWB', bool()], ['Отправлено', num(10, 0)],
  ['Пояснение', str(500)],
];
const statusCols = [
  ['Заказ1С', ref('DocumentRef.ЗаказПокупателя')], ['ИдЗадания', num(15, 0)], ['СтатусПродавца', str(30)], ['СтатусWB', str(30)],
  ['Отменен', bool()], ['Действие', str(300)],
];

const col = (t, n, cap, w) => input(t + n, t + '.' + n, { readOnly: true, caption: cap, width: w });

const ordersTable = table('Заказы', [
  checkbox('ЗаказыПрименить', 'Заказы.Применить', { caption: 'Создать', titleLoc: 'None' }),
  col('Заказы', 'Статус', 'Статус', 11),
  col('Заказы', 'ИдЗадания', '№ задания WB', 9),
  col('Заказы', 'ДатаЗаказа', 'Создано на WB', 10),
  col('Заказы', 'Артикул', 'Артикул', 7),
  col('Заказы', 'Номенклатура', 'Товар в 1С', 22),
  col('Заказы', 'КакНайден', 'Найден по', 7),
  col('Заказы', 'Цена', 'Цена, руб.', 6),
  col('Заказы', 'Заказ1С', 'Заказ в 1С', 14),
  col('Заказы', 'Пояснение', 'Пояснение', 24),
]);

const statusesTable = table('Статусы', [
  col('Статусы', 'Заказ1С', 'Заказ в 1С', 16),
  col('Статусы', 'ИдЗадания', '№ задания WB', 9),
  col('Статусы', 'СтатусПродавца', 'Статус продавца', 9),
  col('Статусы', 'СтатусWB', 'Статус WB', 12),
  col('Статусы', 'Действие', 'Что сделано', 30),
], { title: 'Статусы загруженных заказов', height: 5 });

const stocksTable = table('Остатки', [
  checkbox('ОстаткиВыгрузить', 'Остатки.Выгрузить', { caption: 'Выгрузить', titleLoc: 'None' }),
  col('Остатки', 'Статус', 'Статус', 11),
  col('Остатки', 'АртикулПродавца', 'Артикул', 7),
  col('Остатки', 'chrtID', 'ID размера WB', 8),
  col('Остатки', 'Номенклатура', 'Товар в 1С', 24),
  col('Остатки', 'КакНайден', 'Найден по', 7),
  col('Остатки', 'Свободно', 'Свободно в 1С', 6),
  col('Остатки', 'КВыгрузке', 'Выгрузим', 5),
  col('Остатки', 'НаWB', 'Сейчас на WB', 6),
  col('Остатки', 'Пояснение', 'Пояснение', 30),
]);

const ordersPage = page('СтраницаЗаказы', 'Заказы WB', [
  group('ГруппаКомандыЗаказов', 'Команды', 'AlwaysHorizontal', [
    button('КнопкаПолучитьЗаказы', 'Form.Command.ПолучитьЗаказы', true),
    button('КнопкаСоздатьЗаказы', 'Form.Command.СоздатьЗаказы'),
    button('КнопкаОбновитьСтатусы', 'Form.Command.ОбновитьСтатусы'),
    group('ГруппаПериод', 'За период', 'AlwaysHorizontal', [
      input('ПериодНачало', 'ПериодНачало', { caption: 'Задания с', width: 9 }),
      input('ПериодКонец', 'ПериодКонец', { caption: 'по', width: 9 }),
      button('КнопкаЗаказыЗаПериод', 'Form.Command.ЗаказыЗаПериод'),
    ], { repr: 'WeakSeparation' }),
  ]),
  input('СводкаЗаказов', 'СводкаЗаказов', { readOnly: true, titleLoc: 'None', multiLine: true, height: 2 }),
  ordersTable,
  statusesTable,
]);

const stocksPage = page('СтраницаОстатки', 'Остатки', [
  group('ГруппаКомандыОстатков', 'Команды', 'AlwaysHorizontal', [
    button('КнопкаРассчитатьОстатки', 'Form.Command.РассчитатьОстатки'),
    button('КнопкаВыгрузитьОстатки', 'Form.Command.ВыгрузитьОстатки'),
  ]),
  input('СводкаОстатков', 'СводкаОстатков', { readOnly: true, titleLoc: 'None', multiLine: true, height: 2 }),
  stocksTable,
]);

const onParam = [['OnChange', 'НастройкаПриИзменении']];
const settingsPage = page('СтраницаНастройки', 'Настройки', [
  group('ГруппаПодключение', 'Подключение к WB', 'Vertical', [
    input('Токен', 'Токен', { width: 40, hint: 'категории «Маркетплейс» и «Контент»', events: onParam }),
    group('ГруппаСкладWB', 'Склад WB', 'AlwaysHorizontal', [
      input('СкладWB', 'СкладWB', { width: 12, events: onParam }),
      button('КнопкаПолучитьСклады', 'Form.Command.ПолучитьСклады'),
    ]),
    input('АдресМаркетплейс', 'АдресМаркетплейс', { width: 40, events: onParam }),
    input('АдресКонтент', 'АдресКонтент', { width: 40, events: onParam }),
  ], { showTitle: true, repr: 'WeakSeparation' }),
  group('ГруппаЗаказы', 'Заказы покупателей', 'Vertical', [
    input('Организация', 'Организация', { width: 30, events: onParam }),
    input('Контрагент', 'Контрагент', { width: 30, events: onParam }),
    input('Договор', 'Договор', { width: 30, events: onParam }),
    input('Склад', 'Склад', { width: 30, events: onParam }),
    input('СостояниеЗаказа', 'СостояниеЗаказа', { width: 30, hint: 'как в новом заказе', events: onParam }),
    checkbox('Резервировать', 'Резервировать', { events: onParam }),
    checkbox('ЗакрыватьОтмененные', 'ЗакрыватьОтмененные', { events: onParam }),
  ], { showTitle: true, repr: 'WeakSeparation' }),
  group('ГруппаОстатки', 'Выгрузка остатков', 'AlwaysHorizontal', [
    input('ПроцентОстатка', 'ПроцентОстатка', { width: 4, events: onParam }),
    input('СтраховойЗапас', 'СтраховойЗапас', { width: 5, events: onParam }),
  ], { showTitle: true, repr: 'WeakSeparation' }),
  button('КнопкаСохранитьНастройки', 'Form.Command.СохранитьНастройки'),
]);

const items = [
  pages('Страницы', [ordersPage, stocksPage, settingsPage]),
  input('Прогресс', 'Прогресс', { readOnly: true, titleLoc: 'None' }),
];

const attributes = [
  attr('Объект', '', ref('ExternalDataProcessorObject.ОбменWildberries'), '<MainAttribute>true</MainAttribute>'),
  attr('Токен', 'Токен API WB', str()),
  attr('АдресМаркетплейс', 'Адрес API Маркетплейс', str()),
  attr('АдресКонтент', 'Адрес API Контент', str()),
  attr('СкладWB', 'ID склада продавца на WB', num(15, 0, 'Nonnegative')),
  attr('Склад', 'Склад 1С', ref('CatalogRef.СтруктурныеЕдиницы')),
  attr('Организация', 'Организация', ref('CatalogRef.Организации')),
  attr('Контрагент', 'Контрагент Wildberries', ref('CatalogRef.Контрагенты')),
  attr('Договор', 'Договор', ref('CatalogRef.ДоговорыКонтрагентов')),
  attr('СостояниеЗаказа', 'Состояние нового заказа', ref('CatalogRef.СостоянияЗаказовПокупателей')),
  attr('Резервировать', 'Резервировать товар под задание', bool()),
  attr('ЗакрыватьОтмененные', 'Закрывать заказы, отменённые на WB', bool()),
  attr('ПроцентОстатка', 'Выгружать % свободного остатка', num(3, 0, 'Nonnegative')),
  attr('СтраховойЗапас', 'Страховой запас, шт.', num(10, 0, 'Nonnegative')),
  attr('ПериодНачало', 'Задания с', date()),
  attr('ПериодКонец', 'по', date()),
  attr('СводкаЗаказов', '', str()),
  attr('СводкаОстатков', '', str()),
  attr('Прогресс', '', str()),
  attr('АдресСостояния', '', str()),
  attr('ТекущаяОперация', '', str()),
  attr('РежимПакета', '', bool()),
  attr('ПутьОтчета', '', str()),
  valueTable('Заказы', 'Задания WB', orderCols),
  valueTable('Остатки', 'Остатки', stockCols),
  valueTable('Статусы', 'Статусы', statusCols),
];

let cmdId = 0;
const command = (name, caption, tooltip) => `<Command name="${name}" id="${++cmdId}">${title(caption)}<ToolTip>${ru(tooltip)}</ToolTip><Action>${name}</Action><CurrentRowUse>DontUse</CurrentRowUse></Command>`;
const commands = [
  command('ПолучитьЗаказы', 'Получить новые задания', 'Новые сборочные задания WB: сопоставить с товарами 1С, ничего не записывая'),
  command('ЗаказыЗаПериод', 'Получить за период', 'Все задания WB за период, например после простоя обмена'),
  command('СоздатьЗаказы', 'Создать заказы в 1С', 'Создать «Заказы покупателей» по отмеченным заданиям, с резервом товара'),
  command('ОбновитьСтатусы', 'Обновить статусы', 'Проверить статусы загруженных заданий и закрыть отменённые на WB'),
  command('РассчитатьОстатки', 'Рассчитать остатки', 'Свободный остаток склада 1С против того, что сейчас стоит на WB'),
  command('ВыгрузитьОстатки', 'Выгрузить на WB', 'Отправить отмеченные остатки на склад продавца и сверить результат'),
  command('ПолучитьСклады', 'Склады WB', 'Получить список складов продавца на WB'),
  command('СохранитьНастройки', 'Сохранить настройки', 'Сохранить настройки, токен попадёт в безопасное хранилище'),
];

const ns = 'xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcssch="http://v8.1c.ru/8.1/data-composition-system/schema" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21"';

const xml = `﻿<?xml version="1.0" encoding="UTF-8"?>
<Form ${ns}>
${title('Обмен с Wildberries')}
<WindowOpeningMode>LockOwner</WindowOpeningMode>
<AutoTitle>false</AutoTitle>
<Group>Vertical</Group>
<CommandBarLocation>None</CommandBarLocation>
<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>
${events([['OnOpen', 'ПриОткрытии'], ['OnCreateAtServer', 'ПриСозданииНаСервере']])}
<ChildItems>${items.join('\n')}</ChildItems>
<Attributes>${attributes.join('\n')}</Attributes>
<Commands>${commands.join('\n')}</Commands>
</Form>
`;
fs.writeFileSync(process.argv[2], xml, 'utf8');
console.log('written', process.argv[2], 'ids', id);
