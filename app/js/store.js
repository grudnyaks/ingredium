// Состояние пользователя. localStorage может быть недоступен (приватный режим, ограничения), поэтому всё в try/catch.
const KEY = "ingredium.v1";
const DEFAULTS = {
  mode: "consumer",           // consumer | pro
  jur: "RU",                  // RU EU US KR CN JP
  theme: "system",            // system | light | dark | lab | powder | sage | midnight | custom
  custom: { accent: "#7c5cff", bg: "#f4f2ff", dark: false, radius: 22, glass: 0.6 },
  reduceMotion: false,
  xp: 0,
  streak: { count: 0, last: null, freezeWeek: null },
  lessons: {},                // id -> {done:true, score}
  srs: {},                    // cardId -> {ef, int, due, reps}
  quiz: { answered: 0, correct: 0 },
  seenDay: null,
  onboarded: false
};

let state;
try {
  state = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
} catch { state = { ...DEFAULTS }; }
state.custom = { ...DEFAULTS.custom, ...(state.custom || {}) };
state.streak = { ...DEFAULTS.streak, ...(state.streak || {}) };

const subs = new Set();
export const get = () => state;
export function set(patch) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* хранилище недоступно — работаем в памяти */ }
  subs.forEach((f) => f(state));
}
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export function reset() { set({ ...DEFAULTS, mode: state.mode, jur: state.jur, theme: state.theme, custom: state.custom, onboarded: true }); }

// --- Геймификация ---
export const LEVELS = [
  { xp: 0, name: "Стажёр" },
  { xp: 100, name: "Ассистент" },
  { xp: 300, name: "Технолог" },
  { xp: 700, name: "Эксперт" },
  { xp: 1500, name: "Наставник" }
];
export function level(xp = state.xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1];
  return { i, name: cur.name, next: next ? next.name : null, from: cur.xp, to: next ? next.xp : cur.xp, pct: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const weekId = (d) => { const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); const w1 = new Date(t.getFullYear(), 0, 4); return `${t.getFullYear()}-${1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7)}`; };

// Засчитывает активность за сегодня. Одна «заморозка» в неделю спасает серию при пропуске одного дня.
export function touchStreak(now = new Date()) {
  const today = ymd(now);
  const s = { ...state.streak };
  if (s.last === today) return s;
  if (!s.last) s.count = 1;
  else {
    const gap = daysBetween(s.last, today);
    if (gap === 1) s.count += 1;
    else if (gap === 2 && s.freezeWeek !== weekId(now)) { s.count += 1; s.freezeWeek = weekId(now); }
    else s.count = 1;
  }
  s.last = today;
  set({ streak: s });
  return s;
}

export function addXP(n) {
  const before = level().i;
  set({ xp: state.xp + n });
  touchStreak();
  return level().i > before; // true = новый уровень
}

// --- Интервальное повторение (упрощённый SM-2) ---
// grade: 0 = не знаю, 1 = сомневаюсь, 2 = знаю
export function srsGrade(id, grade, now = Date.now()) {
  const c = { ef: 2.5, int: 0, reps: 0, due: 0, ...(state.srs[id] || {}) };
  if (grade === 0) { c.reps = 0; c.int = 0; c.due = now + 60 * 1000; }
  else {
    c.reps += 1;
    c.int = c.reps === 1 ? 1 : c.reps === 2 ? 3 : Math.round(c.int * c.ef);
    if (grade === 1) c.int = Math.max(1, Math.round(c.int * 0.6));
    c.ef = Math.max(1.3, c.ef + (grade === 2 ? 0.1 : -0.15));
    c.due = now + c.int * 86400000;
  }
  set({ srs: { ...state.srs, [id]: c } });
  return c;
}
export const srsDue = (ids, now = Date.now()) => ids.filter((id) => !state.srs[id] || state.srs[id].due <= now);
