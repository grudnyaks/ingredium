import * as D from "./data.js";
import * as S from "./store.js";
import { initTheme, PRESETS } from "./theme.js";
import { fnRu, ANNEX_RU, GROUP_RU } from "./functions-ru.js";
import { LESSONS, LESSON_SRC } from "./learn-content.js";
import { generateQuestion, buildDeck, ingredientOfDay, shuffle } from "./quizgen.js";
import { analyze, ocr } from "./scan.js";

export const APP_VERSION = "0.1.0";

// ---------- утилиты ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = (s) => esc(s).replace(/\n/g, "<br>");
const enc = encodeURIComponent;
const view = () => $("#view");
const isPro = () => S.get().mode === "pro";
const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };

function toast(msg, action) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn sm" id="toastBtn">${esc(action.label)}</button>` : ""}`;
  t.classList.add("show");
  if (action) $("#toastBtn").onclick = () => { t.classList.remove("show"); action.run(); };
  clearTimeout(toast._t);
  if (!action) toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function header(title, sub, back) {
  return `<header class="top">
    ${back ? `<a class="back" href="${back}" aria-label="Назад">‹</a>` : ""}
    <div class="top-text"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>
  </header>`;
}

const srcLink = (s) => (s ? `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : "");
const srcRefs = (ids) => {
  const all = D.sources();
  return (ids || []).map((id) => all[id]).filter(Boolean).map((s) => `<a class="ref" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.t)}">источник</a>`).join(" ");
};

// ---------- маршрутизация ----------
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
let cleanup = null;

async function render() {
  const hash = location.hash.slice(1) || "/today";
  const [path, qs] = hash.split("?");
  const params = new URLSearchParams(qs || "");
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", path.startsWith(t.dataset.tab)));
      const keepScroll = path === "/guide" && guideState.scroll != null;
      try { cleanup = (await fn(m, params)) || null; }
      catch (e) { console.error(e); view().innerHTML = `${header("Ошибка")}<div class="card"><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Перезагрузить</button></div>`; }
      if (!keepScroll) window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = "#/today";
}

async function ensureData() {
  if (D.isLoaded()) return;
  view().innerHTML = `<div class="loading"><div class="spinner"></div><p>Загружаем базу CosIng: 33 тыс. ингредиентов…</p></div>`;
  await D.loadAll();
}

// ---------- Сегодня ----------
route(/^\/today$/, async () => {
  await ensureData();
  const st = S.get();
  const lv = S.level();
  const day = ingredientOfDay();
  const idx = D.indexOfName(day.inci);
  const c = D.card(day.inci);
  const rec = idx >= 0 ? D.rec(idx) : null;
  const dayTitle = c ? c.ru : day.inci;
  const daySub = c ? c.consumer.summary : rec ? rec.fns.map((k) => fnRu(D.fnName(k))).slice(0, 3).join(" · ") : "";
  const next = LESSONS.find((l) => !st.lessons[l.id]?.done);
  const due = S.srsDue(buildDeck().map((x) => x.id)).length;
  const h = new Date().getHours();
  const hello = h < 6 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
  view().innerHTML = `
    ${header(hello, `${D.JURS[st.jur].flag} ${esc(D.JURS[st.jur].name)} · режим «${isPro() ? "Косметолог" : "Потребитель"}»`)}
    <div class="bento">
      <a class="tile hero" href="#/i/${enc(day.inci)}">
        <span class="eyebrow">Ингредиент дня</span>
        <strong class="big">${esc(dayTitle)}</strong>
        ${c ? `<span class="inci">${esc(day.inci)}</span>` : ""}
        <span class="muted clamp3">${esc(daySub)}</span>
        ${day.annexKey ? `<span class="pill warn">ЕС: ${esc(ANNEX_RU[day.annexKey.split("/")[0]].short)} · ${esc(day.annexKey)}</span>` : ""}
      </a>
      <a class="tile" href="#/learn">
        <span class="eyebrow">Серия</span>
        <strong class="num">🔥 ${st.streak.count}</strong>
        <span class="muted">${st.streak.count === 1 ? "день" : st.streak.count >= 2 && st.streak.count <= 4 ? "дня" : "дней"} подряд</span>
      </a>
      <a class="tile" href="#/learn">
        <span class="eyebrow">${esc(lv.name)}</span>
        <strong class="num">${st.xp} XP</strong>
        <div class="bar"><i style="width:${Math.round(lv.pct * 100)}%"></i></div>
        <span class="muted">${lv.next ? `до «${esc(lv.next)}» ${lv.to - st.xp} XP` : "максимальный уровень"}</span>
      </a>
      <a class="tile accent" href="#/scan">
        <span class="eyebrow">Сканер</span>
        <strong>Разобрать состав</strong>
        <span class="muted">Фото этикетки или вставленный текст</span>
      </a>
      <a class="tile" href="#/learn/quiz">
        <span class="eyebrow">Викторина</span>
        <strong>Бесконечный тест</strong>
        <span class="muted">Вопросы из официальных Приложений ЕС</span>
      </a>
      ${next ? `<a class="tile wide" href="#/learn/lesson/${next.id}"><span class="eyebrow">Продолжить курс</span><strong>${next.emoji} ${esc(next.title)}</strong><span class="muted">${next.min} мин · +30 XP</span></a>` : ""}
      <a class="tile wide" href="#/learn/srs"><span class="eyebrow">Повторение</span><strong>${due} карточек к повторению</strong><span class="muted">Интервальное повторение</span></a>
      <a class="tile wide" href="#/guide"><span class="eyebrow">Гид</span><strong>${D.count().toLocaleString("ru")} ингредиентов INCI</strong><span class="muted">${D.cardsList().length} проверенных карточек · Приложения II–VI ЕС</span></a>
    </div>`;
});

// ---------- Гид (виртуальный список) ----------
const ROW = 76;
const guideState = { q: "", filter: "", scroll: null, ids: null };
const FILTERS = [
  ["", "Все"], ["cards", "★ Карточки"], ["restricted", "Ограничения ЕС"], ["annex:II", "Запрещённые"],
  ["preservative", "Консерванты"], ["uv", "УФ-фильтры"], ["humectant", "Увлажнители"], ["emollient", "Эмоленты"],
  ["cleanser", "ПАВ"], ["antioxidant", "Антиоксиданты"], ["exfoliant", "Отшелушивание"], ["colorant", "Красители"]
];

route(/^\/guide$/, async () => {
  await ensureData();
  view().innerHTML = `
    ${header("Гид INCI", `${D.count().toLocaleString("ru")} ингредиентов · CosIng ЕС`)}
    <div class="searchbar">
      <input id="q" type="search" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Название INCI или по-русски…" value="${esc(guideState.q)}" aria-label="Поиск">
    </div>
    <div class="chips" role="tablist">${FILTERS.map(([k, l]) => `<button class="chip ${guideState.filter === k ? "on" : ""}" data-f="${k}">${esc(l)}</button>`).join("")}</div>
    <p class="count muted" id="cnt"></p>
    <div class="vlist" id="vl"><div class="vin" id="vin"></div></div>`;
  const vl = $("#vl"), vin = $("#vin"), q = $("#q"), cnt = $("#cnt");
  let ids = guideState.ids, total = 0, raf = 0, lastFrom = -1, lastTo = -1;

  const apply = () => {
    const t0 = performance.now();
    ids = D.search(guideState.q, guideState.filter);
    guideState.ids = ids;
    total = ids ? ids.length : D.count();
    cnt.textContent = `${total.toLocaleString("ru")} ${total % 10 === 1 && total % 100 !== 11 ? "результат" : "результатов"} · ${Math.max(1, Math.round(performance.now() - t0))} мс`;
    vl.style.height = `${total * ROW}px`;
    lastFrom = lastTo = -1;
    draw();
  };
  const rowHTML = (i) => {
    const r = D.rec(i);
    const c = D.card(r.name);
    const fn = r.fns.slice(0, 3).map((k) => fnRu(D.fnName(k))).join(" · ");
    const tags = [...new Set(r.annex.map((a) => a.split("/")[0]))].map((a) => `<span class="pill ${ANNEX_RU[a].tone}">${ANNEX_RU[a].short}</span>`).join("");
    return `<a class="row" href="#/i/${enc(r.name)}"><span class="row-main"><span class="row-name">${c ? "★ " : ""}${esc(c ? `${c.ru} · ${r.name}` : r.name)}</span><span class="row-fn">${esc(fn || "функция не указана")}</span></span><span class="row-tags">${tags}</span></a>`;
  };
  const draw = () => {
    raf = 0;
    const top = vl.getBoundingClientRect().top + window.scrollY;
    const y = window.scrollY - top;
    const from = Math.max(0, Math.floor(y / ROW) - 8);
    const to = Math.min(total, Math.ceil((y + window.innerHeight) / ROW) + 8);
    if (from === lastFrom && to === lastTo) return;
    lastFrom = from; lastTo = to;
    let html = "";
    for (let k = from; k < to; k++) html += rowHTML(ids ? ids[k] : k);
    vin.style.transform = `translateY(${from * ROW}px)`;
    vin.innerHTML = html;
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(draw); };
  let deb;
  q.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => { guideState.q = q.value; window.scrollTo(0, 0); apply(); }, 120); });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") q.blur(); });
  view().querySelector(".chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    guideState.filter = b.dataset.f; haptic();
    view().querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
    window.scrollTo(0, 0); apply();
  });
  vin.addEventListener("click", () => { guideState.scroll = window.scrollY; });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  apply();
  if (guideState.scroll != null) { const s = guideState.scroll; guideState.scroll = null; requestAnimationFrame(() => { window.scrollTo(0, s); draw(); }); }
  return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
});

// ---------- Карточка ингредиента ----------
const ANNEX_FIELDS = [
  ["prod", "Тип продукта, части тела"], ["max", "Максимальная концентрация в готовом продукте"], ["other", "Прочие условия"],
  ["warn", "Условия применения и предупреждения на этикетке"], ["color", "Цвет"], ["reg", "Регламент"], ["sccs", "Заключения SCCS"], ["cmr", "CMR-классификация"], ["upd", "Обновлено"]
];

function regBlock(rec, c, jur) {
  const J = D.JURS[jur];
  if (jur === "EU") {
    if (!rec.annex.length) return `<div class="status ok"><b>Нет в Приложениях II–VI.</b> Регламент не устанавливает для ингредиента специальных ограничений; общие требования безопасности продукта действуют.</div>`;
    return rec.annex.map((k) => {
      const e = D.annexEntry(k); if (!e) return "";
      const A = ANNEX_RU[e.annex];
      const head = `<div class="status ${A.tone}"><b>${A.name}: ${A.short.toLowerCase()}</b> · позиция ${esc(k)}${e.gloss ? `<br><span class="muted">${esc(e.gloss)}</span>` : ""}</div>`;
      if (!isPro()) {
        const brief = [e.max ? `<p><b>Максимум:</b> ${nl(e.max)}</p>` : "", e.prod ? `<p><b>Где:</b> ${nl(e.prod)}</p>` : "", e.warn ? `<p><b>Предупреждения:</b> ${nl(e.warn)}</p>` : ""].join("");
        return head + (brief ? `<div class="kv">${brief}<p class="muted small">Официальный текст на английском. Подробности в режиме «Косметолог».</p></div>` : "");
      }
      const rows = ANNEX_FIELDS.filter(([f]) => e[f]).map(([f, l]) => `<div class="kv-row"><dt>${l}</dt><dd>${nl(e[f])}</dd></div>`).join("");
      return head + `<dl class="kv">${rows}<div class="kv-row"><dt>Химическое название</dt><dd>${nl(e.chem)}</dd></div></dl>`;
    }).join("");
  }
  const r = c && c.reg ? c.reg[jur] : null;
  if (r) return `<div class="status info"><b>${esc(r.s)}</b></div><p>${esc(r.t)} ${srcRefs(r.src)}</p>`;
  return `<div class="status none"><b>Не проверено.</b> В базе Ингредиума нет проверенных данных по этому ингредиенту для юрисдикции «${esc(J.name)}». Мы не подставляем значения по аналогии.</div>
    ${jur === "RU" ? `<p class="small muted">С 28.10.2026 действуют изменения ТР ТС 009/2011 (Решение Совета ЕЭК № 74 от 12.09.2025): расширены перечни запрещённых и ограниченных веществ, красителей, консервантов и УФ-фильтров.</p>` : ""}
    <p class="small">Первоисточник: <a href="${esc(J.url)}" target="_blank" rel="noopener">${esc(J.law)}</a></p>`;
}

route(/^\/i\/(.+)$/, async (m) => {
  await ensureData();
  const name = decodeURIComponent(m[1]);
  const idx = D.indexOfName(name);
  if (idx < 0) { view().innerHTML = `${header("Не найдено", "", "#/guide")}<div class="card"><p>Ингредиент «${esc(name)}» не найден в CosIng.</p></div>`; return; }
  const rec = D.rec(idx);
  const c = D.card(rec.name);
  const st = S.get();
  const fns = rec.fns.map((k) => `<span class="pill">${esc(fnRu(D.fnName(k)))}</span>`).join("");
  const jurs = Object.entries(D.JURS).map(([k, j]) => `<button class="seg-b ${st.jur === k ? "on" : ""}" data-j="${k}" aria-label="${esc(j.name)}">${j.flag}<span>${k}</span></button>`).join("");
  const srcAll = D.sources();
  const usedSrc = new Set();
  const collect = (arr) => (arr || []).forEach((x) => (x.src || []).forEach((s) => usedSrc.add(s)));
  if (c) { collect(c.mech); collect(c.dose); collect(c.form); collect(c.syn_with); collect(c.anti_with); Object.values(c.reg || {}).forEach((r) => r && r.src.forEach((s) => usedSrc.add(s))); }

  const deep = c ? `
    <section class="card">
      <h2>Коротко</h2>
      <p>${esc(c.consumer.summary)}</p>
      ${c.consumer.good.length ? `<h3>Для чего</h3><ul>${c.consumer.good.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
      ${c.consumer.caution.length ? `<h3>Осторожно</h3><ul class="warnlist">${c.consumer.caution.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
    </section>
    ${isPro() && c.mech.length ? `<section class="card"><h2>Механизм</h2>${c.mech.map((x) => `<p>${esc(x.t)} ${srcRefs(x.src)}</p>`).join("")}</section>` : ""}
    ${c.dose.length ? `<section class="card"><h2>${isPro() ? "Концентрация → эффект" : "Что показали исследования"}</h2>
      ${isPro() ? `<div class="table-wrap"><table><thead><tr><th>Концентрация</th><th>Эффект</th><th>Доказательность</th></tr></thead><tbody>${c.dose.map((d) => `<tr><td class="nowrap">${esc(d.c)}</td><td>${esc(d.e)} ${srcRefs(d.src)}</td><td class="muted">${esc(d.ev)}</td></tr>`).join("")}</tbody></table></div>`
      : `<ul>${c.dose.map((d) => `<li>${esc(d.e)} ${srcRefs(d.src)}</li>`).join("")}</ul>`}</section>` : ""}
    ${isPro() && c.form.length ? `<section class="card"><h2>Ввод в рецептуру</h2>${c.form.map((f) => `<p><b>${esc(f.k)}.</b> ${esc(f.v)} ${srcRefs(f.src)}</p>`).join("")}</section>` : ""}
    ${c.syn_with.length || c.anti_with.length ? `<section class="card"><h2>Синергия и конфликты</h2>
      ${c.syn_with.map((s) => `<div class="combo good"><a href="#/i/${enc(s.inci)}">＋ ${esc(s.ru)}</a><p>${esc(s.t)} ${srcRefs(s.src)}</p></div>`).join("")}
      ${c.anti_with.map((s) => `<div class="combo bad"><a href="#/i/${enc(s.inci)}">⚠ ${esc(s.ru)}</a><p>${esc(s.t)} ${srcRefs(s.src)}</p></div>`).join("")}
    </section>` : ""}` : `<section class="card note"><p>Глубокая карточка для этого ингредиента ещё не подготовлена. Ниже официальные данные CosIng; мы ничего не дописываем без источника.</p></section>`;

  view().innerHTML = `
    ${header(c ? c.ru : rec.name, c ? `<span class="inci">${esc(rec.name)}</span>${c.syn.length ? ` · ${esc(c.syn.slice(0, 3).join(", "))}` : ""}` : "", "#/guide")}
    ${c ? `<div class="badge-verified">★ Проверенная карточка · ${esc(c.cls)}</div>` : ""}
    <div class="pills">${fns || `<span class="pill">Функция в CosIng не указана</span>`}</div>
    <section class="card">
      <h2>Регуляторный статус</h2>
      <div class="seg" id="jur">${jurs}</div>
      <div id="reg">${regBlock(rec, c, st.jur)}</div>
    </section>
    ${deep}
    ${isPro() ? `<section class="card"><h2>Идентификаторы</h2><dl class="kv">
      <div class="kv-row"><dt>INCI</dt><dd>${esc(rec.name)}</dd></div>
      ${rec.cas ? `<div class="kv-row"><dt>CAS</dt><dd>${esc(rec.cas)}</dd></div>` : ""}
      ${rec.ec ? `<div class="kv-row"><dt>EC</dt><dd>${esc(rec.ec)}</dd></div>` : ""}
      ${rec.ref ? `<div class="kv-row"><dt>CosIng</dt><dd><a href="https://ec.europa.eu/growth/tools-databases/cosing/details/${esc(rec.ref)}" target="_blank" rel="noopener">${esc(rec.ref)}</a></dd></div>` : ""}
    </dl></section>` : ""}
    <section class="card"><h2>Источники</h2><ul class="srcs">
      ${[...usedSrc].map((s) => srcAll[s]).filter(Boolean).map((s) => `<li>${srcLink(s)}</li>`).join("")}
      <li><a class="src" href="https://ec.europa.eu/growth/tools-databases/cosing/" target="_blank" rel="noopener">CosIng, © European Union 1995–2026 (CC BY 4.0): функции, Приложения II–VI</a></li>
    </ul></section>
    ${!isPro() ? `<button class="btn ghost full" id="toPro">Показать всё для косметолога</button>` : ""}`;

  $("#jur").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-b"); if (!b) return;
    haptic(); S.set({ jur: b.dataset.j });
    $("#jur").querySelectorAll(".seg-b").forEach((x) => x.classList.toggle("on", x === b));
    $("#reg").innerHTML = regBlock(rec, c, b.dataset.j);
  });
  const tp = $("#toPro"); if (tp) tp.onclick = () => { S.set({ mode: "pro" }); render(); };
});

// ---------- Сканер ----------
const SAMPLE = "Ingredients: Aqua, Glycerin, Niacinamide, Butylene Glycol, Caprylic/Capric Triglyceride, Cetearyl Alcohol, Glyceryl Stearate, Dimethicone, Tranexamic Acid, Sodium Hyaluronate, Panthenol, Carbomer, Sodium Hydroxide, Phenoxyethanol, Ethylhexylglycerin, Disodium EDTA, Parfum, Limonene, Linalool";
let lastScan = "";

route(/^\/scan$/, async () => {
  view().innerHTML = `
    ${header("Сканер состава", "Фото этикетки или текст INCI")}
    <section class="card">
      <label class="drop" for="file"><span class="drop-ico">📷</span><b>Сфотографировать или выбрать фото</b><span class="muted small">Распознавание идёт на устройстве, фото никуда не отправляется</span></label>
      <input id="file" type="file" accept="image/*" hidden>
      <div id="ocrp" class="bar hidden"><i style="width:0%"></i></div>
      <p class="small muted">Совет для iPhone: откройте фото, нажмите на значок «Текст на фото», скопируйте состав и вставьте ниже. Так обычно точнее.</p>
      <textarea id="txt" rows="5" placeholder="Вставьте состав: Aqua, Glycerin, …">${esc(lastScan)}</textarea>
      <div class="row-btns"><button class="btn" id="go">Разобрать</button><button class="btn ghost" id="sample">Пример</button></div>
    </section>
    <div id="out"></div>`;
  const run = async () => {
    const text = $("#txt").value.trim();
    if (!text) return toast("Вставьте состав или сфотографируйте этикетку");
    lastScan = text;
    $("#out").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    await ensureData();
    const a = analyze(text, S.get().jur);
    renderScan(a);
    S.touchStreak();
  };
  $("#go").onclick = run;
  $("#sample").onclick = () => { $("#txt").value = SAMPLE; run(); };
  $("#file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const bar = $("#ocrp"); bar.classList.remove("hidden");
    toast("Распознаём текст…");
    try {
      const text = await ocr(f, (p) => { const i = bar.querySelector("i"); if (i) i.style.width = `${Math.round(p * 100)}%`; });
      $("#txt").value = text.trim(); bar.classList.add("hidden"); run();
    } catch (err) { bar.classList.add("hidden"); toast(err.message); }
    e.target.value = "";
  };
  if (lastScan) run();
});

function renderScan(a) {
  const st = S.get();
  const groupRows = Object.entries(a.groups).filter(([, v]) => v.length).sort((x, y) => y[1].length - x[1].length)
    .map(([g, v]) => `<div class="gbar"><span>${esc(GROUP_RU[g])}</span><span class="gnum">${v.length}</span><div class="bar"><i style="width:${Math.round((v.length / Math.max(1, a.found.length)) * 100)}%"></i></div></div>`).join("");
  const flags = a.flags.map((f) => {
    const A = ANNEX_RU[f.e.annex];
    return `<li><a href="#/i/${enc(D.item(f.r.i)[0])}">${esc(D.item(f.r.i)[0])}</a> — <span class="pill ${A.tone}">${f.allergen ? "Аллерген отдушки" : A.short}</span> ${esc(f.k)}${f.e.max && isPro() ? `<br><span class="muted small">Максимум: ${esc(f.e.max.split("\n")[0])}</span>` : ""}</li>`;
  }).join("");
  $("#out").innerHTML = `
    <section class="card">
      <h2>Распознано ${a.found.length} из ${a.rows.length} (${a.pct}%)</h2>
      <ol class="ilist">${a.rows.map((r) => r.i >= 0
        ? `<li><a href="#/i/${enc(D.item(r.i)[0])}">${esc(D.item(r.i)[0])}</a>${r.how === "fuzzy" ? ` <span class="muted small">← «${esc(r.t)}», проверьте</span>` : ""}${D.card(D.item(r.i)[0]) ? " <span class=\"pill info\">★</span>" : ""}</li>`
        : `<li class="miss">${esc(r.t)} <span class="muted small">— нет в CosIng</span></li>`).join("")}</ol>
      <p class="small muted">Ингредиенты с концентрацией ниже 1% могут идти в любом порядке после остальных (Регламент (ЕС) 1223/2009, ст. 19), поэтому проценты по порядку в списке определить нельзя.</p>
    </section>
    <section class="card"><h2>Вероятный тип средства</h2>
      ${a.rules.length ? a.rules.map((r) => `<p><b>${esc(r.v)}.</b> <span class="muted">${esc(r.why)}</span></p>`).join("") : `<p class="muted">Недостаточно данных для гипотезы.</p>`}
      <p class="small muted">Это гипотеза по функциям ингредиентов и их месту в списке, а не измерение.</p>
    </section>
    <section class="card"><h2>Органолептика по составу</h2>${a.organo.map((o) => `<p>${esc(o)}</p>`).join("")}</section>
    <section class="card"><h2>Профиль функций</h2>${groupRows || `<p class="muted">Нет данных</p>`}</section>
    <section class="card"><h2>Регуляторные отметки ЕС</h2>${flags ? `<ul class="flags">${flags}</ul>` : `<p>Ни одного ингредиента из Приложений II–VI.</p>`}
      ${st.jur !== "EU" ? `<p class="small muted">Выбрана юрисдикция ${esc(D.JURS[st.jur].name)}. Полная проверка доступна для ЕС; по другим юрисдикциям смотрите карточки ингредиентов.</p>` : ""}</section>
    ${a.deep.length ? `<section class="card"><h2>Активы с проверенными карточками</h2><div class="pills">${a.deep.map((r) => { const c = D.card(D.item(r.i)[0]); return `<a class="pill info" href="#/i/${enc(c.inci)}">★ ${esc(c.ru)}</a>`; }).join("")}</div></section>` : ""}`;
}

// ---------- Обучение ----------
route(/^\/learn$/, async () => {
  await ensureData();
  const st = S.get(), lv = S.level();
  const deck = buildDeck();
  const due = S.srsDue(deck.map((x) => x.id)).length;
  const acc = st.quiz.answered ? Math.round((st.quiz.correct / st.quiz.answered) * 100) : 0;
  view().innerHTML = `
    ${header("Учёба", "Курс, повторение и викторина на живых данных")}
    <section class="card level">
      <div class="lv-top"><div><span class="eyebrow">Уровень ${lv.i + 1}</span><h2>${esc(lv.name)}</h2></div><div class="streak">🔥 ${st.streak.count}</div></div>
      <div class="bar big"><i style="width:${Math.round(lv.pct * 100)}%"></i></div>
      <p class="muted small">${st.xp} XP${lv.next ? ` · до «${esc(lv.next)}» ${lv.to - st.xp} XP` : ""} · точность викторины ${acc}%</p>
      <p class="muted small">Если пропустить один день, серия сохранится: одна «заморозка» в неделю.</p>
    </section>
    <div class="bento">
      <a class="tile accent" href="#/learn/quiz"><span class="eyebrow">Бесконечная викторина</span><strong>Вопросы из Приложений ЕС</strong><span class="muted">+10 XP за верный ответ</span></a>
      <a class="tile" href="#/learn/srs"><span class="eyebrow">Повторение</span><strong class="num">${due}</strong><span class="muted">карточек готово</span></a>
    </div>
    <h2 class="sec">Курс</h2>
    <div class="lessons">${LESSONS.map((l, i) => {
      const done = st.lessons[l.id]?.done;
      const locked = i > 0 && !st.lessons[LESSONS[i - 1].id]?.done && !done;
      return `<a class="lesson ${done ? "done" : ""} ${locked ? "locked" : ""}" href="${locked ? "javascript:void 0" : `#/learn/lesson/${l.id}`}" ${locked ? 'aria-disabled="true"' : ""}>
        <span class="l-emoji">${locked ? "🔒" : done ? "✅" : l.emoji}</span><span class="l-main"><b>${i + 1}. ${esc(l.title)}</b><span class="muted small">${l.min} мин · ${l.quiz.length} вопроса${done ? ` · ${st.lessons[l.id].score}/${l.quiz.length}` : ""}</span></span></a>`;
    }).join("")}</div>`;
  view().querySelectorAll(".lesson.locked").forEach((el) => el.addEventListener("click", () => toast("Сначала пройдите предыдущий урок")));
});

function quizUI(root, q, onDone) {
  const correct = q.a[0];
  const opts = shuffle(q.a);
  root.innerHTML = `<p class="q">${esc(q.q)}</p><div class="opts">${opts.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join("")}</div><div class="why"></div>`;
  root.querySelector(".opts").addEventListener("click", (e) => {
    const b = e.target.closest(".opt"); if (!b || root.dataset.done) return;
    root.dataset.done = "1"; haptic();
    const ok = opts[+b.dataset.i] === correct;
    root.querySelectorAll(".opt").forEach((x) => { if (opts[+x.dataset.i] === correct) x.classList.add("right"); });
    if (!ok) b.classList.add("wrong");
    const src = typeof q.src === "string" ? LESSON_SRC[q.src] : q.src;
    root.querySelector(".why").innerHTML = `<p class="${ok ? "okmsg" : "errmsg"}">${ok ? "Верно!" : "Неверно."}</p>${q.why ? `<p class="small">${esc(q.why)}</p>` : ""}${src ? `<p class="small">Источник: ${srcLink(src)}</p>` : ""}`;
    onDone(ok);
  });
}

route(/^\/learn\/quiz$/, async () => {
  await ensureData();
  view().innerHTML = `${header("Викторина", "Вопросы генерируются из официальных данных", "#/learn")}<section class="card" id="qbox"></section><button class="btn full" id="next" disabled>Следующий вопрос</button><p class="small muted center" id="qs"></p>`;
  let streak = 0;
  const next = () => {
    const q = generateQuestion();
    const box = $("#qbox"); delete box.dataset.done;
    $("#next").disabled = true;
    quizUI(box, q, (ok) => {
      const st = S.get();
      S.set({ quiz: { answered: st.quiz.answered + 1, correct: st.quiz.correct + (ok ? 1 : 0) } });
      streak = ok ? streak + 1 : 0;
      if (ok && S.addXP(10)) toast(`Новый уровень: ${S.level().name}!`);
      else if (!ok) S.touchStreak();
      $("#qs").textContent = streak > 1 ? `Подряд верно: ${streak}` : "";
      $("#next").disabled = false;
    });
  };
  $("#next").onclick = next;
  next();
});

route(/^\/learn\/lesson\/(\w+)$/, async (m) => {
  const L = LESSONS.find((l) => l.id === m[1]);
  if (!L) { location.hash = "#/learn"; return; }
  view().innerHTML = `${header(`${L.emoji} ${L.title}`, `${L.min} мин`, "#/learn")}
    ${L.blocks.map((b) => `<section class="card"><h2>${esc(b.h)}</h2><p>${esc(b.p)}</p><p class="small">${srcLink(LESSON_SRC[b.src])}</p></section>`).join("")}
    <h2 class="sec">Проверка</h2><div id="lq"></div><div id="lres"></div>`;
  let score = 0, answered = 0;
  const box = $("#lq");
  L.quiz.forEach((q) => {
    const el = document.createElement("section"); el.className = "card"; box.appendChild(el);
    quizUI(el, q, (ok) => {
      answered++; if (ok) score++;
      if (answered === L.quiz.length) {
        const first = !S.get().lessons[L.id]?.done;
        S.set({ lessons: { ...S.get().lessons, [L.id]: { done: true, score } } });
        const up = S.addXP(first ? 30 + score * 5 : score * 2);
        $("#lres").innerHTML = `<section class="card done-card"><h2>Урок пройден: ${score}/${L.quiz.length}</h2><p>${first ? `+${30 + score * 5}` : `+${score * 2}`} XP${up ? ` · новый уровень «${esc(S.level().name)}»!` : ""}</p><a class="btn full" href="#/learn">К курсу</a></section>`;
        $("#lres").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });
});

route(/^\/learn\/srs$/, async () => {
  await ensureData();
  const deck = buildDeck();
  const map = new Map(deck.map((x) => [x.id, x]));
  let queue = shuffle(S.srsDue(deck.map((x) => x.id))).slice(0, 20);
  view().innerHTML = `${header("Повторение", "Знаю · сомневаюсь · не знаю", "#/learn")}<div id="srs"></div>`;
  const show = () => {
    const root = $("#srs");
    if (!queue.length) { root.innerHTML = `<section class="card center"><h2>На сегодня всё 🎉</h2><p class="muted">Карточки вернутся, когда подойдёт срок повторения.</p><a class="btn" href="#/learn">К учёбе</a></section>`; return; }
    const card = map.get(queue[0]);
    root.innerHTML = `<p class="muted small center">Осталось: ${queue.length}</p>
      <button class="flash" id="fl" aria-label="Перевернуть карточку"><span class="f-front">${esc(card.f)}</span><span class="f-back hidden">${esc(card.b)}${card.src ? `<span class="small muted block">${esc(card.src.t)}</span>` : ""}</span><span class="tap muted small">нажмите, чтобы перевернуть</span></button>
      <div class="grades hidden" id="gr"><button class="btn bad" data-g="0">Не знаю</button><button class="btn mid" data-g="1">Сомневаюсь</button><button class="btn good" data-g="2">Знаю</button></div>`;
    $("#fl").onclick = () => { $("#fl").classList.add("flipped"); root.querySelector(".f-back").classList.remove("hidden"); root.querySelector(".tap").classList.add("hidden"); $("#gr").classList.remove("hidden"); haptic(); };
    $("#gr").onclick = (e) => {
      const b = e.target.closest("[data-g]"); if (!b) return;
      const g = +b.dataset.g; S.srsGrade(card.id, g); S.addXP(g === 2 ? 3 : 1);
      queue.shift(); if (g === 0) queue.push(card.id);
      show();
    };
  };
  show();
});

// ---------- Настройки ----------
route(/^\/settings$/, async () => {
  const st = S.get();
  const themes = [["system", "Как в системе"], ...Object.entries(PRESETS).map(([k, p]) => [k, p.label]), ["custom", "Своя"]];
  view().innerHTML = `
    ${header("Ещё", `Ингредиум ${APP_VERSION} · данные ${D.DATA_VERSION}`)}
    <section class="card"><h2>Режим</h2>
      <div class="seg two" id="mode"><button class="seg-b ${st.mode === "consumer" ? "on" : ""}" data-m="consumer">🙂 Потребитель</button><button class="seg-b ${st.mode === "pro" ? "on" : ""}" data-m="pro">🧑‍🔬 Косметолог</button></div>
      <p class="small muted">«Косметолог» показывает концентрации, правила ввода, полный текст Приложений ЕС и идентификаторы.</p>
    </section>
    <section class="card"><h2>Юрисдикция по умолчанию</h2>
      <div class="seg" id="jur">${Object.entries(D.JURS).map(([k, j]) => `<button class="seg-b ${st.jur === k ? "on" : ""}" data-j="${k}">${j.flag}<span>${k}</span></button>`).join("")}</div>
      <p class="small muted" id="jurName">${esc(D.JURS[st.jur].name)}: ${esc(D.JURS[st.jur].law)}</p>
    </section>
    <section class="card"><h2>Тема</h2>
      <div class="themes" id="themes">${themes.map(([k, l]) => `<button class="theme-b ${st.theme === k ? "on" : ""}" data-t="${k}"><span class="sw sw-${k}" ${PRESETS[k] ? `style="background:linear-gradient(135deg, ${PRESETS[k].bg} 50%, ${PRESETS[k].accent} 50%)"` : ""}></span>${esc(l)}</button>`).join("")}</div>
      <div id="custom" class="${st.theme === "custom" ? "" : "hidden"}">
        <label class="field">Акцент <input type="color" id="c-acc" value="${esc(st.custom.accent)}"></label>
        <label class="field">Фон <input type="color" id="c-bg" value="${esc(st.custom.bg)}"></label>
        <label class="field">Тёмная основа <input type="checkbox" id="c-dark" ${st.custom.dark ? "checked" : ""}></label>
        <label class="field col">Скругление: <span id="c-rv">${st.custom.radius}</span> px <input type="range" id="c-rad" min="6" max="32" value="${st.custom.radius}"></label>
        <label class="field col">«Стекло» (прозрачность и размытие) <input type="range" id="c-gl" min="0" max="1" step="0.05" value="${st.custom.glass}"></label>
      </div>
      <label class="field">Меньше анимации и прозрачности <input type="checkbox" id="rm" ${st.reduceMotion ? "checked" : ""}></label>
    </section>
    <section class="card"><h2>Установка</h2>
      <ol class="small"><li>Откройте приложение в Safari.</li><li>Нажмите «Поделиться» → «На экран Домой».</li><li>Запускайте с иконки: приложение откроется на весь экран и будет работать офлайн.</li></ol>
      <p class="small"><b>Android:</b> <a href="https://github.com/grudnyaks/ingredium/releases/tag/apk-latest" target="_blank" rel="noopener">скачать APK</a> или в Chrome: ⋮ → «Установить приложение».</p>
      <button class="btn ghost full" id="upd">Проверить обновления</button>
    </section>
    <section class="card"><h2>Данные и источники</h2>
      <p class="small">CosIng, © European Union, 1995–2026. Приложения II–VI Регламента (ЕС) 1223/2009 (обновление 13.10.2026, выгрузка 26.10.2026). Повторное использование по Решению 2011/833/EU (CC BY 4.0). Функции по зеркалу cosingchecker.com.</p>
      <p class="small">Глубокие карточки: только рецензируемые исследования, нормативные акты и заключения научных комитетов. Если данных нет, мы так и пишем: «не проверено».</p>
      <p class="small muted">Справочная информация, а не медицинская или юридическая консультация.</p>
    </section>
    <button class="btn ghost full danger" id="reset">Сбросить прогресс обучения</button>`;
  const v = view();
  v.querySelector("#mode").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; S.set({ mode: b.dataset.m }); haptic(); v.querySelectorAll("#mode .seg-b").forEach((x) => x.classList.toggle("on", x === b)); };
  v.querySelector("#jur").onclick = (e) => { const b = e.target.closest("[data-j]"); if (!b) return; S.set({ jur: b.dataset.j }); haptic(); v.querySelectorAll("#jur .seg-b").forEach((x) => x.classList.toggle("on", x === b)); $("#jurName").textContent = `${D.JURS[b.dataset.j].name}: ${D.JURS[b.dataset.j].law}`; };
  v.querySelector("#themes").onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; S.set({ theme: b.dataset.t }); haptic(); v.querySelectorAll(".theme-b").forEach((x) => x.classList.toggle("on", x === b)); $("#custom").classList.toggle("hidden", b.dataset.t !== "custom"); };
  const cu = (patch) => S.set({ custom: { ...S.get().custom, ...patch }, theme: "custom" });
  $("#c-acc").oninput = (e) => cu({ accent: e.target.value });
  $("#c-bg").oninput = (e) => cu({ bg: e.target.value });
  $("#c-dark").onchange = (e) => cu({ dark: e.target.checked, bg: e.target.checked ? "#0e0e14" : "#f4f2ff" });
  $("#c-rad").oninput = (e) => { $("#c-rv").textContent = e.target.value; cu({ radius: +e.target.value }); };
  $("#c-gl").oninput = (e) => cu({ glass: +e.target.value });
  $("#rm").onchange = (e) => S.set({ reduceMotion: e.target.checked });
  $("#upd").onclick = () => checkUpdate(true);
  $("#reset").onclick = () => { if (confirmInline($("#reset"))) { S.reset(); toast("Прогресс сброшен"); render(); } };
});

// Подтверждение без системного диалога: первое нажатие меняет надпись, второе выполняет.
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1"; const t = btn.textContent; btn.textContent = "Нажмите ещё раз для подтверждения";
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = t; }, 3000);
  return false;
}

// ---------- обновления по воздуху ----------
// В APK (Capacitor) файлы лежат внутри приложения: сверяем версию с сайтом и предлагаем скачать свежий APK.
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const REMOTE = "https://grudnyaks.github.io/ingredium/";
const APK_URL = "https://github.com/grudnyaks/ingredium/releases/tag/apk-latest";
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

let swReg = null;
async function checkUpdate(manual) {
  if (IS_NATIVE) {
    try {
      const v = await (await fetch(`${REMOTE}version.json?t=${Date.now()}`, { cache: "no-store" })).json();
      if (newer(v.version, APP_VERSION)) toast(`Вышла версия ${v.version}`, { label: "Скачать", run: () => window.open(APK_URL, "_blank") });
      else if (manual) toast(`Установлена последняя версия ${APP_VERSION}`);
    } catch { if (manual) toast("Нет связи: проверим обновления позже"); }
    return;
  }
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const v = await r.json();
    if (swReg) await swReg.update();
    if (v.version !== APP_VERSION) {
      if (!swReg || !swReg.waiting) toast(`Загружаем версию ${v.version}…`);
    } else if (manual) toast(`Установлена последняя версия ${APP_VERSION}`);
  } catch { if (manual) toast("Нет связи: проверим обновления позже"); }
}

function promptUpdate(worker) {
  toast("Доступно обновление", { label: "Обновить", run: () => worker.postMessage({ type: "SKIP_WAITING" }) });
}

async function initSW() {
  if (IS_NATIVE) { checkUpdate(false); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(false); }); return; }
  if (!("serviceWorker" in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register("sw.js");
    if (swReg.waiting && navigator.serviceWorker.controller) promptUpdate(swReg.waiting);
    swReg.addEventListener("updatefound", () => {
      const w = swReg.installing;
      w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) promptUpdate(w); });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(false); });
    setInterval(() => checkUpdate(false), 30 * 60 * 1000);
  } catch (e) { console.warn("SW", e); }
}

// ---------- старт ----------
initTheme();
window.addEventListener("hashchange", render);
render();
initSW();
// Карточки нужны на главной сразу; базу CosIng подгружаем в фоне.
D.loadAll().catch((e) => console.error(e));
