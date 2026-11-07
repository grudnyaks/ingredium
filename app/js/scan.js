// Разбор состава: OCR на устройстве (Tesseract.js, загружается только при необходимости), сопоставление с CosIng и прозрачный анализ.
import * as D from "./data.js";
import { GROUP_RU } from "./functions-ru.js";

const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script");
    s.src = src; s.async = true; s.crossOrigin = "anonymous";
    s.onload = () => res(); s.onerror = () => rej(new Error("Не удалось загрузить модуль распознавания. Нужен интернет при первом запуске."));
    document.head.appendChild(s);
  });
}

// Уменьшаем фото до 2000 px по длинной стороне: распознавание быстрее, качество не страдает.
async function downscale(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.25)";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export async function ocr(file, onProgress) {
  await loadScript(TESS_URL);
  const img = await downscale(file);
  const { data } = await window.Tesseract.recognize(img, "eng+rus", {
    logger: (m) => { if (m.status === "recognizing text" && onProgress) onProgress(m.progress); }
  });
  return data.text || "";
}

// --- Парсинг ---
export function splitInci(text) {
  let t = (text || "").replace(/\r/g, "");
  const m = t.match(/(ingredients|ingrédients|inci|состав)\s*[:：]/i);
  if (m) t = t.slice(m.index + m[0].length);
  t = t.replace(/-\n(?=[a-z])/gi, "").replace(/\n+/g, " ");
  // Не разрезаем запятые внутри скобок, например «CI 77491, CI 77492» в «+/- (...)»
  const parts = []; let depth = 0, cur = "";
  for (const ch of t) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";" || ch === "•" || ch === "·") && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((s) => s.replace(/^\s*(may contain|\+\/-|может содержать)\s*[:]?/i, "").replace(/[.*]+\s*$/, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 1 && s.length < 160);
}

function matchToken(tok) {
  const variants = [tok];
  const inParen = tok.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (inParen) variants.push(inParen[1], inParen[2], ...inParen[2].split(/\s*[,\/]\s*/));
  if (/\band\b/i.test(tok)) variants.push(...tok.split(/\s*\(?\band\b\)?\s*/i));
  variants.push(tok.replace(/\s*\[nano\]|\(nano\)/i, ""));
  for (const v of variants) {
    const i = D.indexOfName(v.trim());
    if (i >= 0) return { i, how: "exact" };
  }
  const f = D.fuzzy(variants[variants.length - 1] || tok);
  return f >= 0 ? { i: f, how: "fuzzy" } : { i: -1, how: "none" };
}

// --- Анализ ---
export function analyze(text, jur = "EU") {
  const tokens = splitInci(text);
  const rows = tokens.map((t, pos) => ({ t, pos, ...matchToken(t) }));
  const found = rows.filter((r) => r.i >= 0);
  const groups = {};
  for (const g of Object.keys(GROUP_RU)) groups[g] = found.filter((r) => D.hasGroup(r.i, g));
  const top = (g, n) => groups[g].some((r) => r.pos < n);
  const flags = [];
  for (const r of found) {
    const rec = D.rec(r.i);
    for (const k of rec.annex) {
      const e = D.annexEntry(k);
      if (!e) continue;
      const allergen = e.annex === "III" && /0[,.]001 ?% in leave-on/i.test(`${e.other || ""} ${e.warn || ""} ${e.max || ""}`);
      flags.push({ r, k, e, allergen });
    }
  }
  const deep = found.filter((r) => D.card(D.item(r.i)[0]));
  const names = found.map((r) => D.item(r.i)[0]);

  // Гипотеза о типе средства: явные правила, каждое объясняется пользователю.
  const rules = [];
  const firstWater = rows.length && /^(aqua|water|вода)/i.test(rows[0].t);
  if (groups.propellant.length) rules.push({ v: "Аэрозоль", why: "Есть пропеллент." });
  if (top("cleanser", 5) && !top("emulsifier", 3)) rules.push({ v: "Смываемое очищающее средство", why: "Очищающие ПАВ среди первых пяти ингредиентов." });
  if (top("uv", 10)) rules.push({ v: "Средство с УФ-фильтрами", why: "УФ-фильтры среди первых десяти ингредиентов." });
  if (groups.emulsifier.length && groups.emollient.length && firstWater) rules.push({ v: "Эмульсия (крем, лосьон)", why: "Вода в начале, есть эмоленты и эмульгаторы." });
  if (firstWater && !top("emollient", 6) && groups.humectant.length) rules.push({ v: groups.thickener.length ? "Водный гель или сыворотка" : "Тоник или эссенция на водной основе", why: groups.thickener.length ? "Вода в начале, увлажнители, загустители и мало эмолентов в начале списка." : "Вода в начале, увлажнители, нет загустителей и эмолентов в начале списка." });
  if (!firstWater && rows.length && top("emollient", 2) && !names.includes("AQUA")) rules.push({ v: "Безводный продукт (масло, бальзам)", why: "Список начинается с эмолентов, воды нет." });
  if (groups.exfoliant.length) rules.push({ v: "Есть отшелушивающие компоненты", why: `По CosIng функция отшелушивания или кератолиза: ${groups.exfoliant.map((r) => D.item(r.i)[0]).join(", ")}.` });

  const organo = [];
  if (names.includes("PARFUM") || names.includes("FRAGRANCE") || groups.fragrance.length) organo.push(`Аромат: есть ароматизирующие компоненты (${groups.fragrance.length}).`);
  else organo.push("Аромат: ароматизирующие компоненты не найдены.");
  if (groups.colorant.length) organo.push(`Цвет: есть красители (${groups.colorant.map((r) => D.item(r.i)[0]).join(", ")}).`);
  if (groups.thickener.length) organo.push(`Консистенция: загустители и гелеобразователи (${groups.thickener.length}).`);
  if (groups.film.length) organo.push(`Ощущение на коже: плёнкообразователи (${groups.film.length}).`);
  if (groups.emollient.length) organo.push(`Ощущение на коже: эмоленты и окклюзивы (${groups.emollient.length}).`);

  return { rows, found, groups, flags, deep, rules, organo, jur, pct: rows.length ? Math.round((found.length / rows.length) * 100) : 0 };
}
