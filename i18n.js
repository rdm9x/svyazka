// Языки Связки: русский (исходные строки в коде) и английский (словари в lang/*.js).
// Общий для окна (браузер) и для svyazka (Node). Строка переводится вызовом t('Русский текст {0}', значение):
// ключ словаря — сам русский текст, {0}, {1}… — подстановки. Нет перевода — остаётся русский.

export const LANGS = ['ru', 'en'];
let cur = 'ru';

export const lang = () => cur;
export function setLang(l) { cur = LANGS.includes(l) ? l : 'ru'; return cur; }

// Язык по тегу системы ('ru-RU', 'ru_RU.UTF-8', 'en-AM'…): русский — только для ru, остальным английский
export const langFromTag = (tag) => (/^ru(?:[-_.]|$)/i.test(String(tag || '').trim()) ? 'ru' : 'en');

const fill = (s, a) => (a.length ? s.replace(/\{(\d+)\}/g, (m, i) => (a[i] != null ? String(a[i]) : m)) : s);

// t для набора словарей: makeT({ en: EN })
export function makeT(dicts) {
  return (s, ...a) => {
    const d = dicts[cur];
    return fill(d && d[s] != null ? d[s] : s, a);
  };
}

// Локаль для дат, чисел и сортировки
export const locale = () => (cur === 'en' ? 'en-US' : 'ru-RU');

// Число со словом: plural(5, ['запись', 'записи', 'записей'], ['item', 'items']) → «5 записей» / «5 items»
export function plural(n, ru, en) {
  let w;
  if (cur === 'en') w = Math.abs(n) === 1 ? en[0] : en[1];
  else {
    const a = Math.abs(n) % 100, b = a % 10;
    w = a > 10 && a < 20 ? ru[2] : b > 1 && b < 5 ? ru[1] : b === 1 ? ru[0] : ru[2];
  }
  return `${n} ${w}`;
}
