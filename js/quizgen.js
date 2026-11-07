// Генераторы вопросов и карточек из официальных данных: вопросы бесконечны и всегда со ссылкой на позицию Приложения.
import * as D from "./data.js";
import { fnRu, ANNEX_RU } from "./functions-ru.js";
import { LESSONS, LESSON_SRC } from "./learn-content.js";

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const firstName = (g) => (g || "").split(/\s*[\/;,]\s*|\n/).map((s) => s.trim()).find((s) => s && s !== "-" && s.length <= 48);
const oneLine = (s) => s && !s.includes("\n") && s.length <= 22;
const COSING = "https://ec.europa.eu/growth/tools-databases/cosing/";

let pools = null;
function buildPools() {
  const all = D.annexAll();
  const byAnnex = { II: [], III: [], IV: [], V: [], VI: [] };
  for (const [k, e] of Object.entries(all)) {
    const nm = firstName(e.gloss) || (e.annex === "II" && e.chem && e.chem.length <= 48 && !e.chem.includes("\n") ? e.chem : null);
    if (nm) byAnnex[e.annex].push({ k, e, nm });
  }
  const maxPool = { V: byAnnex.V.filter((x) => oneLine(x.e.max)), VI: byAnnex.VI.filter((x) => oneLine(x.e.max)) };
  pools = { byAnnex, maxPool };
  return pools;
}

function qAnnex() {
  const p = pools || buildPools();
  const annex = pick(Object.keys(p.byAnnex));
  const x = pick(p.byAnnex[annex]);
  const wrong = shuffle(Object.keys(ANNEX_RU).filter((a) => a !== annex)).slice(0, 3);
  return {
    q: `В каком приложении Регламента (ЕС) 1223/2009 указано вещество «${x.nm}»?`,
    a: [annex, ...wrong].map((a) => `${ANNEX_RU[a].name}: ${ANNEX_RU[a].short.toLowerCase()}`),
    why: `Позиция ${x.k}. ${ANNEX_RU[annex].desc}.`,
    src: { t: `CosIng, позиция ${x.k}`, url: COSING }
  };
}

function qMax() {
  const p = pools || buildPools();
  const annex = Math.random() < 0.6 ? "V" : "VI";
  const pool = p.maxPool[annex];
  const x = pick(pool);
  const others = shuffle([...new Set(pool.map((y) => y.e.max).filter((m) => m !== x.e.max))]).slice(0, 3);
  if (others.length < 3) return null;
  return {
    q: `Максимальная концентрация «${x.nm}» в готовом продукте как ${annex === "V" ? "консерванта" : "УФ-фильтра"} в ЕС?`,
    a: [x.e.max, ...others],
    why: `${ANNEX_RU[annex].name}, позиция ${x.k}${x.e.prod ? `. Тип продукта: ${x.e.prod}` : ""}.`,
    src: { t: `CosIng, позиция ${x.k}`, url: COSING }
  };
}

function qFunction() {
  const n = D.count();
  for (let tries = 0; tries < 50; tries++) {
    const r = D.rec(rnd(n));
    if (!r.fns.length || r.fns.length > 3 || r.name.length > 40) continue;
    const own = new Set(r.fns.map(D.fnName));
    const correct = fnRu(D.fnName(pick(r.fns)));
    const pool = [];
    for (let k = 0; k < 81; k++) { const f = D.fnName(k); if (f && !own.has(f)) pool.push(fnRu(f)); }
    const wrong = shuffle([...new Set(pool)].filter((x) => x !== correct)).slice(0, 3);
    return {
      q: `Какая функция указана в CosIng для «${r.name}»?`,
      a: [correct, ...wrong],
      why: `Все функции по CosIng: ${[...own].map(fnRu).join(", ")}.`,
      src: { t: `CosIng: ${r.name}`, url: r.ref ? `${COSING}details/${r.ref}` : COSING },
      inci: r.name
    };
  }
  return null;
}

export function generateQuestion() {
  const gens = [qAnnex, qMax, qFunction];
  for (let i = 0; i < 10; i++) {
    const q = pick(gens)();
    if (q) return q;
  }
  return qAnnex();
}

// Колода для интервального повторения: факты из глубоких карточек, уроков и пределов Приложений V/VI.
export function buildDeck() {
  const deck = [];
  const srcs = D.sources();
  for (const c of D.cardsList()) {
    for (const [j, m] of (c.mech || []).entries()) deck.push({ id: `m:${c.inci}:${j}`, f: `${c.ru}: как работает?`, b: m.t, src: srcs[m.src[0]] });
    for (const [j, d] of (c.dose || []).entries()) deck.push({ id: `d:${c.inci}:${j}`, f: `${c.ru}, ${d.c}: что показано?`, b: `${d.e} (${d.ev})`, src: srcs[d.src[0]] });
    for (const [j, f] of (c.form || []).entries()) deck.push({ id: `f:${c.inci}:${j}`, f: `${c.ru}: ${f.k.toLowerCase()}?`, b: f.v, src: srcs[f.src[0]] });
  }
  for (const L of LESSONS) for (const [j, b] of L.blocks.entries()) deck.push({ id: `l:${L.id}:${j}`, f: `${L.title}: ${b.h}`, b: b.p, src: LESSON_SRC[b.src] });
  const p = pools || buildPools();
  for (const a of ["V", "VI"]) for (const x of p.maxPool[a]) deck.push({ id: `x:${x.k}`, f: `${x.nm}: максимум в ЕС (${ANNEX_RU[a].short.toLowerCase()})?`, b: `${x.e.max} (позиция ${x.k})`, src: { t: `CosIng, ${x.k}`, url: COSING } });
  return deck;
}

// Ингредиент дня: чередуем глубокие карточки и ограниченные вещества из Приложения III.
export function ingredientOfDay(date = new Date()) {
  const di = D.dayIndex(date);
  const cards = D.cardsList();
  if (di % 2 === 0 && cards.length) return { inci: cards[(di / 2) % cards.length].inci, deep: true };
  const p = pools || buildPools();
  const list = p.byAnnex.III.filter((x) => D.indexOfName(x.nm) >= 0);
  if (!list.length) return { inci: cards[0].inci, deep: true };
  const x = list[di % list.length];
  return { inci: D.item(D.indexOfName(x.nm))[0], deep: false, annexKey: x.k };
}
