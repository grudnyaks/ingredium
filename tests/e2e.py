#!/usr/bin/env python3
"""Сквозная проверка PWA в эмуляции iPhone: ошибки консоли, горизонтальные переполнения (переносы),
виртуальный скролл, скорость поиска, сканер, викторина, темы, Service Worker.

Запуск:  python3 tests/e2e.py   (поднимает локальный сервер на app/)
"""
import json, sys, threading, time, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "app"
PORT = 8765
BASE = f"http://localhost:{PORT}/"
fails, notes = [], []


def check(cond, msg):
    (notes if cond else fails).append(("OK  " if cond else "FAIL") + " " + msg)


def serve():
    h = functools.partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    h.log_message = lambda *a: None
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


OVERFLOW_JS = """() => {
  const W = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('#view *, .tabbar, .tabbar *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.closest('.table-wrap') || el.closest('.chips')) continue; // горизонтальная прокрутка там намеренная
    if (r.right > W + 1 || r.left < -1) bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  return { sw: document.documentElement.scrollWidth, cw: W, bad: bad.slice(0, 8) };
}"""


def no_overflow(page, label):
    r = page.evaluate(OVERFLOW_JS)
    check(r["sw"] <= r["cw"] and not r["bad"], f"нет горизонтального переполнения: {label} {r if r['bad'] or r['sw'] > r['cw'] else ''}")


def main():
    srv = serve()
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", args=["--no-sandbox"])
        for vp in [(375, 667, "iPhone SE"), (390, 844, "iPhone 15"), (430, 932, "iPhone 15 Pro Max"), (320, 568, "узкий 320px")]:
            ctx = b.new_context(viewport={"width": vp[0], "height": vp[1]}, device_scale_factor=3, is_mobile=True, has_touch=True,
                                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
                                locale="ru-RU")
            page = ctx.new_page()
            errs = []
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append(str(e)))
            tag = vp[2]

            page.goto(BASE + "#/today"); page.wait_for_selector(".bento", timeout=20000)
            no_overflow(page, f"{tag} /today")
            for r in ["/guide", "/scan", "/learn", "/settings", "/learn/quiz", "/learn/srs", "/learn/lesson/inci"]:
                page.goto(BASE + "#" + r); page.wait_for_timeout(400)
                no_overflow(page, f"{tag} {r}")

            # Карточки: проверенная, самая длинная INCI, с большим текстом Приложения
            longest = page.evaluate("""async () => { const d = await (await fetch('data/inci.json?v=x')).json(); return d.items.reduce((a, b) => b[0].length > a.length ? b[0] : a, ''); }""")
            for nm, mode in [("NIACINAMIDE", "consumer"), ("NIACINAMIDE", "pro"), ("THIOGLYCOLIC ACID", "pro"), ("RETINOL", "pro"), (longest, "pro"), ("HYDROQUINONE", "pro")]:
                page.evaluate(f"""() => {{ const s = JSON.parse(localStorage.getItem('ingredium.v1') || '{{}}'); s.mode = '{mode}'; s.jur = 'EU'; localStorage.setItem('ingredium.v1', JSON.stringify(s)); }}""")
                page.goto(BASE + "#/i/" + nm.replace("/", "%2F")); page.reload(); page.wait_for_selector("#reg", timeout=20000)
                no_overflow(page, f"{tag} карточка {nm[:40]} ({mode})")
            if tag == "iPhone 15":
                page.screenshot(path="/tmp/shot_card.png", full_page=False)

            errs_route = [e for e in errs if "favicon" not in e]
            check(not errs_route, f"{tag}: нет ошибок консоли {errs_route[:3]}")
            ctx.close()

        # --- Функциональные проверки на iPhone 15 ---
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, locale="ru-RU")
        page = ctx.new_page(); errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.goto(BASE + "#/guide"); page.wait_for_selector(".row", timeout=20000)

        n_rows = page.locator(".row").count()
        check(10 < n_rows < 60, f"виртуальный список держит в DOM только видимые строки: {n_rows}")
        # Глубокий скролл: строки должны быть отрисованы в нижней части списка
        page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.7)"); page.wait_for_timeout(200)
        vis = page.evaluate("""() => { const H = innerHeight; return [...document.querySelectorAll('.row')].filter(r => { const b = r.getBoundingClientRect(); return b.bottom > 0 && b.top < H; }).length; }""")
        check(vis >= 8, f"после глубокого скролла видимые строки отрисованы: {vis}")
        # Скорость прокрутки: время отрисовки окна строк
        t = page.evaluate("""async () => { const ts = []; for (let i = 0; i < 40; i++) { const t0 = performance.now(); window.scrollBy(0, 1500); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); ts.push(performance.now() - t0); } ts.sort((a,b)=>a-b); return { med: ts[20], p95: ts[37] }; }""")
        check(t["p95"] < 60, f"прокрутка без лагов: медиана {t['med']:.1f} мс, p95 {t['p95']:.1f} мс на кадр")

        page.evaluate("window.scrollTo(0,0)")
        page.fill("#q", "niacinam"); page.wait_for_timeout(500)
        txt = page.inner_text("#cnt"); first = page.inner_text(".row >> nth=0")
        check("Ниацинамид" in first or "NIACINAMIDE" in first, f"поиск «niacinam» находит ниацинамид первым: {first[:60]!r} / {txt}")
        ms = int(txt.split("·")[-1].strip().split()[0])
        check(ms < 150, f"поиск по 33 тыс. за {ms} мс")
        page.fill("#q", "гиалурон"); page.wait_for_timeout(500)
        check("HYALURONIC" in page.inner_text(".row >> nth=0"), "поиск по-русски («гиалурон»)")
        page.fill("#q", ""); page.wait_for_timeout(300)
        page.click(".chip[data-f='preservative']"); page.wait_for_timeout(400)
        check(page.locator(".row").count() > 5, "фильтр «Консерванты» работает")
        # Возврат из карточки сохраняет позицию скролла
        page.click(".chip[data-f='']"); page.wait_for_timeout(300)
        page.evaluate("window.scrollTo(0, 30000)"); page.wait_for_timeout(250)
        y0 = page.evaluate("scrollY")
        page.locator(".row").nth(12).click(); page.wait_for_selector("#reg")
        page.go_back(); page.wait_for_timeout(600)
        y1 = page.evaluate("scrollY")
        check(abs(y1 - y0) < 5, f"позиция скролла восстановлена после возврата: {y0} → {y1}")

        # Сканер
        page.goto(BASE + "#/scan"); page.click("#sample"); page.wait_for_selector("#out h2", timeout=20000)
        out = page.inner_text("#out")
        check("Распознано 19 из 19" in out, f"сканер распознал пример целиком: {out.splitlines()[0]}")
        check("Аллерген отдушки" in out, "сканер отмечает аллергены отдушки (Limonene, Linalool)")
        check("Эмульсия" in out, "сканер выдвигает гипотезу «эмульсия»")
        page.fill("#txt", "Состав: Aqa, Glycerinn, Niacinamid, Sodum Benzoate"); page.click("#go"); page.wait_for_timeout(800)
        out2 = page.inner_text("#out")
        check("проверьте" in out2 and "Распознано 4 из 4" in out2, f"нечёткое совпадение при опечатках OCR: {out2.splitlines()[0]}")
        no_overflow(page, "сканер с результатом")

        # Генератор вопросов: 300 вопросов без дефектов
        res = page.evaluate("""async () => { const m = await import('./js/quizgen.js'); const bad = []; for (let i = 0; i < 300; i++) { const q = m.generateQuestion(); if (!q || q.a.length !== 4 || new Set(q.a).size !== 4 || q.a.some(x => !x || x.includes('undefined')) || !q.src) bad.push(q && q.q); } const d = m.buildDeck(); return { bad: bad.slice(0, 3), nbad: bad.length, deck: d.length, deckBad: d.filter(c => !c.f || !c.b).length }; }""")
        check(res["nbad"] == 0, f"300 сгенерированных вопросов корректны (4 разных варианта, есть источник): {res}")
        check(res["deck"] > 50 and res["deckBad"] == 0, f"колода повторения: {res['deck']} карточек")

        # Викторина + XP
        page.goto(BASE + "#/learn/quiz"); page.wait_for_selector(".opt")
        page.locator(".opt").first.click(); page.wait_for_timeout(200)
        check(page.locator(".why p").count() >= 1 and not page.is_disabled("#next"), "викторина показывает разбор и активирует «Следующий»")
        # Урок целиком
        page.goto(BASE + "#/learn/lesson/inci"); page.wait_for_selector(".opt")
        for i in range(3):
            page.locator("#lq section").nth(i).locator(".opt").first.click()
        page.wait_for_selector(".done-card")
        st = page.evaluate("JSON.parse(localStorage.getItem('ingredium.v1'))")
        check(st["lessons"].get("inci", {}).get("done") and st["xp"] >= 30 and st["streak"]["count"] == 1, f"урок засчитан, XP {st['xp']}, серия {st['streak']['count']}")
        # SRS
        page.goto(BASE + "#/learn/srs"); page.wait_for_selector("#fl"); page.click("#fl"); page.click("[data-g='2']"); page.wait_for_timeout(200)
        st = page.evaluate("JSON.parse(localStorage.getItem('ingredium.v1'))")
        check(len(st["srs"]) == 1, "интервальное повторение сохраняет оценку")

        # Серия: логика заморозки
        r = page.evaluate("""async () => { const S = await import('./js/store.js'); S.set({ streak: { count: 5, last: '2026-11-01', freezeWeek: null } });
          const a = S.touchStreak(new Date('2026-11-03T10:00:00')).count; const b = S.touchStreak(new Date('2026-11-06T10:00:00')).count; return [a, b]; }""")
        check(r == [6, 1], f"серия: пропуск 1 дня спасает заморозка, пропуск 3 дней сбрасывает: {r}")

        # Темы: все применяются без ошибок, тёмная меняет фон
        page.goto(BASE + "#/settings"); page.wait_for_selector("#themes")
        bgs = {}
        for t in ["light", "dark", "lab", "powder", "sage", "midnight", "custom", "system"]:
            page.click(f".theme-b[data-t='{t}']"); page.wait_for_timeout(80)
            bgs[t] = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg')")
        check(bgs["light"] != bgs["dark"] and len(set(bgs.values())) >= 6, f"темы применяются: {len(set(bgs.values()))} разных фонов")
        page.click(".theme-b[data-t='custom']"); page.fill("#c-acc", "#ff0055"); page.wait_for_timeout(100)
        check("255 0 85" in page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent')"), "своя тема: акцентный цвет")
        page.emulate_media(color_scheme="dark"); page.click(".theme-b[data-t='system']"); page.wait_for_timeout(100)
        check(page.evaluate("document.documentElement.dataset.dark") == "1", "системная тема следует тёмному режиму ОС")
        page.emulate_media(color_scheme="light"); page.wait_for_timeout(100)
        check(page.evaluate("document.documentElement.dataset.dark") == "0", "системная тема переключается вслед за ОС на лету")
        page.screenshot(path="/tmp/shot_settings.png")

        # Режимы
        page.click("#mode [data-m='consumer']"); page.goto(BASE + "#/i/NIACINAMIDE"); page.wait_for_selector("#reg")
        c_tables = page.locator("table").count()
        page.goto(BASE + "#/settings"); page.click("#mode [data-m='pro']"); page.goto(BASE + "#/i/NIACINAMIDE"); page.wait_for_selector("#reg")
        p_tables = page.locator("table").count()
        check(c_tables == 0 and p_tables == 1, f"режим «Косметолог» показывает таблицу концентраций, «Потребитель» — нет ({c_tables}/{p_tables})")
        page.click("#jur [data-j='KR']"); page.wait_for_timeout(100)
        check("2,0–5,0%" in page.inner_text("#reg"), "юрисдикция KR: ниацинамид 2–5%")
        page.click("#jur [data-j='RU']"); page.wait_for_timeout(100)
        check("Не проверено" in page.inner_text("#reg"), "юрисдикция RU без источника честно помечена «не проверено»")

        # Service Worker и офлайн
        page.goto(BASE + "#/today"); page.wait_for_timeout(500)
        ok = page.evaluate("""async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }""")
        check(ok, "Service Worker активен")
        page.reload(); page.wait_for_timeout(800)
        ctx.set_offline(True)
        page.goto(BASE + "#/guide"); page.reload(); page.wait_for_selector(".row", timeout=15000)
        check(page.locator(".row").count() > 5, "офлайн: приложение и база открываются из кэша")
        ctx.set_offline(False)

        check(not [e for e in errs if "favicon" not in e and "ERR_INTERNET_DISCONNECTED" not in e], f"функциональные сценарии без ошибок JS: {errs[:3]}")
        b.close()
    srv.shutdown()
    print("\n".join(notes))
    print("\n".join(fails))
    print(f"\nИтого: {len(notes)} OK, {len(fails)} FAIL")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
