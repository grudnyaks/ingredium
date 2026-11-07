#!/usr/bin/env python3
"""Собирает компактные данные ЕС для приложения из снимка CosIng.

Источник: снимок CosIng от 26.10.2026 из открытого репозитория
github.com/jkalend/skincare_ingredients (data/registry/cosing):
  - annex_*.csv — выгрузка напрямую из API Еврокомиссии
    https://api.tech.ec.europa.eu/cosing20/1.0/api/annexes/{II..VI}/export-csv
  - ingredients.json — словарь INCI (Общий глоссарий, Решение (ЕС) 2025/1175)
    с функциями по зеркалу cosingchecker.com.

CosIng, © European Union, 1995–2026. Повторное использование по
Решению Комиссии 2011/833/EU (CC BY 4.0). Изменения: CSV/JSON преобразованы
в компактный JSON, тексты приложений не изменялись.

Запуск:  python3 tools/build_cosing.py
"""
import csv, gzip, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-src" / "cosing"
OUT = ROOT / "app" / "data"
OUT.mkdir(parents=True, exist_ok=True)

ANNEX_COLS = {
    # индекс колонок в CSV (строка заголовка — 5-я строка файла)
    "II": dict(ref=0, chem=1, cas=2, ec=3, reg=4, sccs=6, cmr=9, upd=10),
    "III": dict(ref=0, chem=1, gloss=2, cas=3, ec=4, prod=5, max=6, other=7, warn=8, reg=9, sccs=11, cmr=14, upd=15),
    "IV": dict(ref=0, chem=1, gloss=2, cas=3, ec=4, color=5, prod=6, max=7, other=8, warn=9, reg=10, sccs=12, cmr=15, upd=16),
    "V": dict(ref=0, chem=1, gloss=2, cas=3, ec=4, prod=5, max=6, other=7, warn=8, reg=9, sccs=11, cmr=14, upd=15),
    "VI": dict(ref=0, chem=1, gloss=2, cas=3, ec=4, prod=5, max=6, other=7, warn=8, reg=9, sccs=11, cmr=14, upd=15),
}


def clean(s):
    if s is None:
        return ""
    s = s.replace("\r", "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s)
    return s.strip()


def load_annexes():
    annex = {}
    gloss_to_refs = {}
    for a, cols in ANNEX_COLS.items():
        rows = list(csv.reader(open(SRC / f"annex_{a}.csv", encoding="utf-8")))
        for r in rows[5:]:
            if not r or not r[0].strip():
                continue
            g = lambda k: clean(r[cols[k]]) if k in cols and cols[k] < len(r) else ""
            key = f"{a}/{g('ref')}"
            e = {k: g(k) for k in cols if g(k)}
            e["annex"] = a
            annex[key] = e
            # связываем по названиям из глоссария
            for nm in re.split(r"\s*[/,;]\s*|\n", g("gloss")):
                nm = nm.strip().upper()
                if len(nm) > 2:
                    gloss_to_refs.setdefault(nm, set()).add(key)
    return annex, gloss_to_refs


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else str(SRC / "ingredients.json.gz")
    opener = gzip.open if raw.endswith(".gz") else open
    with opener(raw, "rt", encoding="utf-8") as f:
        ings = json.load(f)
    annex, gloss_to_refs = load_annexes()

    funcs = []
    fidx = {}
    out = []
    seen = set()
    for x in ings:
        name = (x.get("inci_name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        fl = []
        for f in x.get("functions") or []:
            for p in f.split(";"):
                p = p.strip()
                if not p or p == "NOT REPORTED":
                    continue
                if p not in fidx:
                    fidx[p] = len(funcs)
                    funcs.append(p)
                if fidx[p] not in fl:
                    fl.append(fidx[p])
        refs = set()
        for r in (x.get("restriction") or "").replace(",", "\n").split("\n"):
            r = r.strip().replace(" ", "")
            m = re.match(r"^(II|III|IV|V|VI)/(.+)$", r)
            if m and f"{m.group(1)}/{m.group(2)}" in annex:
                refs.add(f"{m.group(1)}/{m.group(2)}")
        refs |= gloss_to_refs.get(name.upper(), set())
        rec = [name, x.get("ref_number") or "", x.get("cas_number") or "", x.get("ec_number") or "", fl, sorted(refs)]
        while rec and rec[-1] in ("", []):
            rec.pop()
        out.append(rec)

    out.sort(key=lambda r: r[0])
    meta = json.load(open(SRC / "manifest.json"))
    payload = {
        "v": 1,
        "source": "CosIng, © European Union, 1995–2026. Annexes II–VI of Regulation (EC) No 1223/2009 "
                  "(EC CosIng API, last update 13/10/2026; fetched 26/10/2026). Ingredient glossary: "
                  "Commission Implementing Decision (EU) 2025/1175; functions via cosingchecker.com mirror. "
                  "Reused under Decision 2011/833/EU (CC BY 4.0).",
        "fetched": meta.get("fetched_at"),
        "functions": funcs,
        "items": out,
    }
    (OUT / "inci.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    (OUT / "annex.json").write_text(json.dumps({"v": 1, "lastUpdate": "13/10/2026", "entries": annex},
                                                ensure_ascii=False, separators=(",", ":")))
    linked = sum(1 for r in out if len(r) > 5)
    print(f"items={len(out)} functions={len(funcs)} annex={len(annex)} linked={linked}")


if __name__ == "__main__":
    main()
