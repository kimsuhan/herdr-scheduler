// Schedules: parsing, the slot a moment belongs to, and whether that slot should run. Also a code
// bot's poll items and the keys it has seen. Pure: no herdr or gpui-kit import, so `node --test` runs it.

const UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n) => String(n).padStart(2, "0");

// "5m", "2h", "1d" as milliseconds.
export function duration(text) {
  const m = /^(\d+)([mhd])$/.exec(String(text).trim());
  if (!m || +m[1] === 0) throw new Error(`"${text}" is not a duration (5m, 2h, 1d)`);
  return +m[1] * UNIT[m[2]];
}

// "09:30" as minutes after midnight.
function clock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`"${text}" is not a time (09:30)`);
  return +m[1] * 60 + +m[2];
}

// { every: "5m" } | { daily: "09:00" } | { weekdays: "09:00" } | { days: [1, 3], at: "09:00" }
// (days: 0 = Sunday) as { every: ms } or { days, at: minutes }.
export function parse(s) {
  if (!s || typeof s !== "object") throw new Error("schedule is missing");
  if (s.every != null) return { every: duration(s.every) };
  if (s.daily != null) return { days: [0, 1, 2, 3, 4, 5, 6], at: clock(s.daily) };
  if (s.weekdays != null) return { days: [1, 2, 3, 4, 5], at: clock(s.weekdays) };
  if (Array.isArray(s.days) && s.days.length && s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    return { days: [...new Set(s.days)].sort(), at: clock(s.at) };
  throw new Error("schedule needs every, daily, weekdays, or days with at");
}

// The time of day `offset` days from `now`, in local time.
function day(p, now, offset) {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  d.setHours(0, p.at, 0, 0);
  return p.days.includes(d.getDay()) ? d.getTime() : null;
}

// The latest scheduled time at or before `now`. `every` counts from the epoch, so "1h" is on the
// hour in most time zones; for a time of day use daily.
export function slot(p, now) {
  if (p.every) return Math.floor(now / p.every) * p.every;
  for (let i = 0; i <= 7; i++) {
    const t = day(p, now, -i);
    if (t != null && t <= now) return t;
  }
}

// The first scheduled time after `now`.
export function next(p, now) {
  if (p.every) return slot(p, now) + p.every;
  for (let i = 0; i <= 7; i++) {
    const t = day(p, now, i);
    if (t != null && t > now) return t;
  }
}

// What to do about the current slot, given the last slot this bot was seen at:
// null (nothing new), or { slot, run }. A bot seen for the first time, and a slot more than
// `grace` ms old, are recorded without running (`first`, `missed`).
export function due(p, last, now, grace) {
  const s = slot(p, now);
  if (last == null) return { slot: s, run: false, first: true };
  if (s <= last) return null;
  const run = now - s <= grace;
  return { slot: s, run, missed: !run, late: now - s };
}

// What a code bot's poll returned, checked: nothing, or an array of objects with a key (made a string).
export function items(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("poll must return an array of items");
  return list.map((it) => {
    if (!it || typeof it !== "object" || it.key == null || it.key === "") throw new Error("every item poll returns needs a key");
    return { ...it, key: String(it.key) };
  });
}

// A bot's seen keys ({ key: ms }) with `key` added at `now`, keeping the newest `cap`.
export function remember(seen, key, now, cap = 500) {
  const all = Object.entries({ ...seen, [key]: now });
  return Object.fromEntries(all.length <= cap ? all : all.sort((a, b) => a[1] - b[1]).slice(-cap));
}

// "every 5m", "daily 09:00", "weekdays 09:00", "Mon, Wed 09:00".
export function describe(p) {
  if (p.every) {
    const u = ["d", "h", "m"].find((k) => p.every % UNIT[k] === 0);
    return `every ${p.every / UNIT[u]}${u}`;
  }
  const days = p.days.join(""), at = `${pad2(Math.floor(p.at / 60))}:${pad2(p.at % 60)}`;
  return `${days === "0123456" ? "daily" : days === "12345" ? "weekdays" : p.days.map((d) => DAY[d]).join(", ")} ${at}`;
}

// History files: one per schedule and local day, a row per line (JSON).

// The day file a row at `at` goes to: "2026-11-13.jsonl".
export function dayFile(at) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.jsonl`;
}

// keepHistory ("30d") as days. Files are by day, so it is whole days.
export function keepDays(text) {
  const ms = duration(text);
  if (ms % UNIT.d) throw new Error("keepHistory is whole days, like 30d");
  return ms / UNIT.d;
}

// The day files to remove when `keep` days are kept: those before the day `keep` days back.
export function expired(files, keep, now) {
  const d = new Date(now);
  d.setDate(d.getDate() - keep);
  const cut = dayFile(d.getTime());
  return files.filter((f) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(f) && f < cut);
}

// A history file's rows, newest first, each id once. A row is written again when a reload cut its
// first write off, and a broken line (a write cut off) is passed over.
export function rows(text) {
  const byId = new Map();
  for (const line of (text ?? "").split("\n")) {
    try { const r = JSON.parse(line); if (r?.id) byId.set(r.id, r); } catch {}
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

// Rows for showing (newest first): rounds in a row that found nothing new are one row, with how many
// (`count`) and when the first was (`from`).
export function fold(list) {
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1], empty = r.status === "checked" && !r.fresh;
    if (empty && last?.status === "checked" && !last.fresh) { last.count = (last.count ?? 1) + 1; last.from = r.at; }
    else out.push({ ...r });
  }
  return out;
}
