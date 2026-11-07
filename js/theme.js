// Темы: системная, светлая, тёмная, пресеты и своя. Применяются CSS-переменными на <html>.
import { get, subscribe } from "./store.js";

export const PRESETS = {
  light:    { label: "Светлая",     dark: false, accent: "#6b4eff", bg: "#f5f5f7", tint: "#ffffff" },
  dark:     { label: "Тёмная",      dark: true,  accent: "#9d86ff", bg: "#0b0b0f", tint: "#1c1c22" },
  lab:      { label: "Лаборатория", dark: false, accent: "#2f6bff", bg: "#eef3fb", tint: "#ffffff" },
  powder:   { label: "Пудра",       dark: false, accent: "#c2577a", bg: "#fbf1ee", tint: "#ffffff" },
  sage:     { label: "Шалфей",      dark: false, accent: "#3f7d5e", bg: "#eff3ec", tint: "#ffffff" },
  midnight: { label: "Полночь",     dark: true,  accent: "#3dd6b0", bg: "#070b18", tint: "#141a2e" }
};

const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const rq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const tq = window.matchMedia ? window.matchMedia("(prefers-reduced-transparency: reduce)") : null;

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  if (!m) return [124, 92, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const rgb = (a) => `rgb(${a[0]} ${a[1]} ${a[2]})`;
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };

export function resolve(s = get()) {
  if (s.theme === "custom") {
    const c = s.custom;
    return { dark: !!c.dark, accent: c.accent, bg: c.bg, tint: c.dark ? "#1c1c22" : "#ffffff", radius: c.radius, glass: c.glass };
  }
  if (s.theme === "system") return { ...PRESETS[mq && mq.matches ? "dark" : "light"], radius: 22, glass: 0.6 };
  return { ...(PRESETS[s.theme] || PRESETS.light), radius: 22, glass: 0.6 };
}

export function apply(s = get()) {
  const t = resolve(s);
  const root = document.documentElement;
  const acc = hexToRgb(t.accent), bg = hexToRgb(t.bg), tint = hexToRgb(t.tint);
  const fg = t.dark ? [242, 242, 247] : [22, 22, 28];
  const reduceT = (tq && tq.matches) || s.reduceMotion;
  const glass = reduceT ? 1 : Math.max(0.35, Math.min(1, 1 - (t.glass ?? 0.6) * 0.45));
  const v = {
    "--bg": rgb(bg),
    "--bg-2": rgb(mix(bg, acc, t.dark ? 0.10 : 0.07)),
    "--surface": `rgb(${tint.join(" ")} / ${glass})`,
    "--surface-solid": rgb(tint),
    "--surface-2": rgb(mix(tint, fg, t.dark ? 0.07 : 0.04)),
    "--fg": rgb(fg),
    "--fg-2": rgb(mix(fg, bg, 0.38)),
    "--fg-3": rgb(mix(fg, bg, 0.55)),
    "--line": `rgb(${fg.join(" ")} / ${t.dark ? 0.12 : 0.09})`,
    "--accent": rgb(acc),
    "--accent-soft": `rgb(${acc.join(" ")} / ${t.dark ? 0.22 : 0.13})`,
    "--on-accent": lum(acc) > 0.45 ? "#111" : "#fff",
    "--radius": `${t.radius ?? 22}px`,
    "--blur": reduceT ? "0px" : `${Math.round(10 + (t.glass ?? 0.6) * 18)}px`
  };
  for (const [k, val] of Object.entries(v)) root.style.setProperty(k, val);
  root.dataset.dark = t.dark ? "1" : "0";
  root.dataset.motion = (rq && rq.matches) || s.reduceMotion ? "reduce" : "full";
  root.style.colorScheme = t.dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", rgb(bg));
}

export function initTheme() {
  apply();
  subscribe(() => apply());
  const onSys = () => apply();
  for (const q of [mq, rq, tq]) if (q) (q.addEventListener ? q.addEventListener("change", onSys) : q.addListener(onSys));
}
