// Загрузка и индексация данных. Все тяжёлые структуры строятся один раз.
import { FN_GROUP } from "./functions-ru.js";

export const DATA_VERSION = "2026-11-08.1";

export const JURS = {
  RU: { flag: "🇷🇺", name: "Россия / ЕАЭС", law: "ТР ТС 009/2011 (ред. от 28.10.2026)", url: "https://www.alta.ru/tamdoc/11sr0799/" },
  EU: { flag: "🇪🇺", name: "Евросоюз", law: "Регламент (ЕС) 1223/2009, Приложения II–VI", url: "https://ec.europa.eu/growth/tools-databases/cosing/" },
  US: { flag: "🇺🇸", name: "США", law: "FD&C Act; OTC-монографии 21 CFR", url: "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-D/part-333/subpart-D" },
  KR: { flag: "🇰🇷", name: "Корея", law: "Закон о косметике; функциональная косметика MFDS", url: "https://www.mfds.go.kr" },
  CN: { flag: "🇨🇳", name: "Китай", law: "STSC 2015 с изменениями; IECIC (NMPA)", url: "https://www.nmpa.gov.cn" },
  JP: { flag: "🇯🇵", name: "Япония", law: "Стандарты косметики MHLW; квази-лекарства", url: "https://www.mhlw.go.jp" }
};

let _inci = null, _annex = null, _cards = null;
let _byName = null, _lower = null, _squash = null, _alias = null, _fnSets = null;

const fetchJSON = async (path) => {
  const r = await fetch(`${path}?v=${DATA_VERSION}`);
  if (!r.ok) throw new Error(`Не удалось загрузить ${path}: ${r.status}`);
  return r.json();
};

export const squash = (s) => s.toUpperCase().replace(/[^A-Z0-9А-ЯЁ]/g, "");

export async function loadCards() {
  if (!_cards) {
    _cards = await fetchJSON("data/cards.json");
    _cards.byInci = new Map(_cards.cards.map((c) => [c.inci, c]));
  }
  return _cards;
}

export async function loadAll() {
  if (_inci && _annex && _cards) return { inci: _inci, annex: _annex, cards: _cards };
  const [inci, annex, cards] = await Promise.all([fetchJSON("data/inci.json"), fetchJSON("data/annex.json"), loadCards()]);
  _inci = inci; _annex = annex;
  const n = inci.items.length;
  _lower = new Array(n); _squash = new Array(n); _byName = new Map();
  for (let i = 0; i < n; i++) {
    const nm = inci.items[i][0];
    _lower[i] = nm.toLowerCase();
    _squash[i] = squash(nm);
    _byName.set(nm, i);
    if (!_byName.has(_squash[i])) _byName.set(_squash[i], i);
  }
  // Русские названия и синонимы из глубоких карточек
  _alias = [];
  for (const c of cards.cards) {
    const i = _byName.get(c.inci);
    if (i === undefined) continue;
    for (const a of [c.ru, ...(c.syn || [])]) _alias.push([a.toLowerCase(), i]);
  }
  // Множества функций по группам
  _fnSets = {};
  for (const [g, list] of Object.entries(FN_GROUP)) {
    _fnSets[g] = new Set(list.map((f) => inci.functions.indexOf(f)).filter((x) => x >= 0));
  }
  return { inci: _inci, annex: _annex, cards: _cards };
}

export const isLoaded = () => !!_inci;
export const count = () => (_inci ? _inci.items.length : 0);
export const item = (i) => _inci.items[i];
export const fnName = (k) => _inci.functions[k];
export const annexEntry = (key) => _annex.entries[key];
export const annexAll = () => _annex.entries;
export const indexOfName = (name) => {
  if (!_byName) return -1;
  const i = _byName.get(name.toUpperCase());
  if (i !== undefined) return i;
  const j = _byName.get(squash(name));
  return j === undefined ? -1 : j;
};
export const card = (inci) => (_cards ? _cards.byInci.get(inci) : null);
export const cardsList = () => (_cards ? _cards.cards : []);
export const sources = () => (_cards ? _cards.sources : {});

export function rec(i) {
  const r = _inci.items[i];
  return { i, name: r[0], ref: r[1] || "", cas: r[2] || "", ec: r[3] || "", fns: r[4] || [], annex: r[5] || [] };
}

export function hasGroup(i, g) {
  const f = _inci.items[i][4];
  if (!f) return false;
  const s = _fnSets[g];
  for (const k of f) if (s.has(k)) return true;
  return false;
}

// Поиск: сначала точное совпадение, затем начало строки, затем вхождение. Возвращает массив индексов.
export function search(q, filter) {
  const n = _inci.items.length;
  const pass = (i) => {
    if (!filter) return true;
    if (filter === "restricted") return !!_inci.items[i][5];
    if (filter === "cards") return _cards.byInci.has(_inci.items[i][0]);
    if (filter.startsWith("annex:")) {
      const a = filter.slice(6) + "/";
      const r = _inci.items[i][5];
      return !!r && r.some((x) => x.startsWith(a));
    }
    return hasGroup(i, filter);
  };
  q = (q || "").trim().toLowerCase();
  if (!q) {
    if (!filter) return null; // null = весь список без копирования
    const out = [];
    for (let i = 0; i < n; i++) if (pass(i)) out.push(i);
    return out;
  }
  const qs = squash(q);
  const exact = [], starts = [], incl = [];
  const seen = new Set();
  for (const [a, i] of _alias) {
    if (a.includes(q) && pass(i) && !seen.has(i)) { seen.add(i); (a.startsWith(q) ? starts : incl).push(i); }
  }
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    const l = _lower[i];
    let hit = 0;
    if (l === q) hit = 3;
    else if (l.startsWith(q)) hit = 2;
    else if (l.includes(q)) hit = 1;
    else if (qs.length > 2 && _squash[i].includes(qs)) hit = 1;
    if (hit && pass(i)) (hit === 3 ? exact : hit === 2 ? starts : incl).push(i);
  }
  return exact.concat(starts, incl);
}

// Нечёткий поиск для сканера: Левенштейн по кандидатам с близкой длиной и тем же первым символом.
export function fuzzy(token, maxDist) {
  const t = squash(token);
  if (t.length < 3) return -1;
  const md = maxDist ?? (t.length > 12 ? 3 : t.length > 6 ? 2 : 1);
  let best = -1, bestD = md + 1;
  for (let i = 0; i < _squash.length; i++) {
    const s = _squash[i];
    if (Math.abs(s.length - t.length) > md || s[0] !== t[0]) continue;
    const d = lev(s, t, bestD);
    if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
  }
  return best;
}

function lev(a, b, cap) {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i; let rowMin = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin >= cap) return cap;
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Детерминированный «ингредиент дня»: одинаков у всех в один день.
export function dayIndex(d = new Date()) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
