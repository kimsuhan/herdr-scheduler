import test from "node:test";
import assert from "node:assert/strict";
import { duration, parse, slot, next, due, describe, items, remember, dayFile, keepDays, expired, rows, fold } from "./schedule.js";

// Local-time dates, so the cases hold in any time zone. 2026-11-12 is a Thursday.
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const MIN = 60_000;

test("duration", () => {
  assert.equal(duration("5m"), 5 * MIN);
  assert.equal(duration("2h"), 120 * MIN);
  for (const bad of ["0m", "5", "5s", "m", ""]) assert.throws(() => duration(bad));
});

test("parse", () => {
  assert.deepEqual(parse({ every: "1m" }), { every: MIN });
  assert.deepEqual(parse({ daily: "09:00" }), { days: [0, 1, 2, 3, 4, 5, 6], at: 540 });
  assert.deepEqual(parse({ weekdays: "9:30" }), { days: [1, 2, 3, 4, 5], at: 570 });
  assert.deepEqual(parse({ days: [3, 1, 3], at: "18:05" }), { days: [1, 3], at: 1085 });
  for (const bad of [null, {}, { daily: "24:00" }, { daily: "9" }, { days: [7], at: "09:00" }, { days: [], at: "09:00" }, { days: [1] }])
    assert.throws(() => parse(bad));
});

test("slot and next: time of day", () => {
  const p = parse({ daily: "09:00" });
  assert.equal(slot(p, at(12, 8, 59)), at(11, 9));
  assert.equal(slot(p, at(12, 9)), at(12, 9));
  assert.equal(next(p, at(12, 9)), at(13, 9));
  assert.equal(next(p, at(12, 8, 59)), at(12, 9));
});

test("slot and next: chosen days skip the others", () => {
  const p = parse({ weekdays: "09:00" });
  assert.equal(next(p, at(13, 10)), at(16, 9)); // Friday 10:00 -> Monday
  assert.equal(slot(p, at(15, 12)), at(13, 9)); // Sunday -> Friday
  const mon = parse({ days: [1], at: "09:00" });
  assert.equal(slot(mon, at(16, 8)), at(9, 9)); // a week back
  assert.equal(next(mon, at(16, 9)), at(23, 9)); // a week ahead
});

test("slot and next: every", () => {
  const p = parse({ every: "5m" }), now = at(12, 9, 7);
  assert.equal(slot(p, now) % (5 * MIN), 0);
  assert.ok(slot(p, now) <= now && now - slot(p, now) < 5 * MIN);
  assert.equal(next(p, now), slot(p, now) + 5 * MIN);
});

test("due", () => {
  const p = parse({ daily: "09:00" }), grace = 90_000;
  assert.deepEqual(due(p, undefined, at(12, 9)), { slot: at(12, 9), run: false, first: true }); // a new bot doesn't fire
  assert.equal(due(p, at(12, 9), at(12, 15), grace), null); // already seen
  assert.equal(due(p, at(11, 9), at(12, 9, 1), grace).run, true); // on time
  const late = due(p, at(11, 9), at(12, 10, 30), grace);
  assert.equal(late.run, false);
  assert.equal(late.missed, true);
  assert.equal(due(p, at(11, 9), at(12, 10, 30), duration("2h")).run, true); // catchUp covers it
  assert.equal(due(p, at(12, 9), at(12, 8), grace), null); // schedule moved earlier after today's run
});

test("describe", () => {
  assert.equal(describe(parse({ every: "90m" })), "every 90m");
  assert.equal(describe(parse({ every: "120m" })), "every 2h");
  assert.equal(describe(parse({ daily: "09:00" })), "daily 09:00");
  assert.equal(describe(parse({ weekdays: "09:05" })), "weekdays 09:05");
  assert.equal(describe(parse({ days: [1, 3], at: "18:30" })), "Mon, Wed 18:30");
});

test("items", () => {
  assert.deepEqual(items(undefined), []);
  assert.deepEqual(items([{ key: 7, thread: "a" }]), [{ key: "7", thread: "a" }]);
  for (const bad of [{}, "x", [null], [{}], [{ key: "" }]]) assert.throws(() => items(bad));
});

test("remember", () => {
  assert.deepEqual(remember({}, "a", 1), { a: 1 });
  assert.deepEqual(remember({ a: 1 }, "b", 2), { a: 1, b: 2 });
  assert.deepEqual(remember({ b: 3, a: 1, c: 2 }, "d", 4, 3), { c: 2, b: 3, d: 4 }); // the oldest goes
});

test("history files: day, keep, expired", () => {
  assert.equal(dayFile(at(3, 23, 59)), "2026-11-03.jsonl");
  assert.equal(keepDays("30d"), 30);
  for (const bad of ["12h", "0d", "30"]) assert.throws(() => keepDays(bad));
  const files = ["2026-10-12.jsonl", "2026-10-13.jsonl", "2026-11-12.jsonl", "notes.txt"];
  assert.deepEqual(expired(files, 30, at(12, 10)), ["2026-10-12.jsonl"]);
});

test("history rows: newest first, each id once, broken lines passed over", () => {
  const text = ['{"id":"a","at":1,"status":"starting"}', '{"id":"b","at":2}', '{"id":"a","at":1,"status":"done"}', '{"id":"c",', ""].join("\n");
  assert.deepEqual(rows(text), [{ id: "b", at: 2 }, { id: "a", at: 1, status: "done" }]);
  assert.deepEqual(rows(null), []);
});

test("fold: rounds in a row with nothing new are one row", () => {
  const c = (at, fresh = 0) => ({ id: String(at), at, status: "checked", items: 1, fresh });
  const folded = fold([c(5), c(4), c(3, 1), { id: "x", at: 2, status: "done" }, c(1), c(0)]);
  assert.deepEqual(folded.map((r) => [r.at, r.count ?? 1, r.from]), [[5, 2, 4], [3, 1, undefined], [2, 1, undefined], [1, 2, 0]]);
});
