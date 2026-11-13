import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { say, keys, LANGUAGES } from "./i18n.js";
import { describe, parse } from "./schedule.js";

const here = (file) => new URL(file, import.meta.url);

test("English is the key, filled in", () => {
  assert.equal(say("en", "{0}h ago", 3), "3h ago");
  assert.equal(say(undefined, "Settings"), "Settings");
  assert.equal(say("xx", "Edit {0}", "a"), "Edit a"); // an unknown language is English
});

test("Korean: keys, messages with a value, schedules", () => {
  assert.equal(say("ko", "{0}h ago", 3), "3시간 전");
  assert.equal(say("ko", "{0} schedules", 4), "스케줄 4개");
  assert.equal(say("ko", '"25:00" is not a time (09:30)'), "올바른 시각이 아닙니다: 25:00 (예: 09:30)");
  assert.equal(say("ko", "a schedule named x is already there"), "x 스케줄이 이미 있습니다");
  assert.equal(say("ko", describe(parse({ every: "90m" }))), "90분마다");
  assert.equal(say("ko", describe(parse({ every: "2h" }))), "2시간마다");
  assert.equal(say("ko", describe(parse({ daily: "09:00" }))), "매일 09:00");
  assert.equal(say("ko", describe(parse({ weekdays: "09:05" }))), "평일 09:05");
  assert.equal(say("ko", describe(parse({ days: [1, 3], at: "18:30" }))), "월, 수 18:30");
  assert.equal(say("ko", "gh pr: something else"), "gh pr: something else"); // unknown text stays as it is
});

// Every L("…") key in the code, and every message the code throws as a plain string, has a text in
// each language: a key that is renamed in the code and not here would quietly show English.
test("each language has every key the code uses", () => {
  const code = ["main.js", "engine.js", "schedule.js"].map((f) => readFileSync(here(f), "utf8")).join("\n");
  const used = new Set();
  for (const m of code.matchAll(/\bL\((?:[^"'`()]*\? )?"((?:[^"\\]|\\.)*)"(?: : "((?:[^"\\]|\\.)*)")?/g)) for (const k of m.slice(1)) if (k) used.add(k.replace(/\\(.)/g, "$1"));
  for (const m of code.matchAll(/new Error\((["'])((?:(?!\1)[^\\]|\\.)*)\1\)/g)) used.add(m[2].replace(/\\(.)/g, "$1"));
  for (const m of code.matchAll(/\[(?:"[a-z]+"|\d), "([A-Z][A-Za-z]+)"\]/g)) used.add(m[1]); // the form's pills
  for (const word of ["broken", "blocked", "running", "paused", "failed", "missed", "interrupted", "starting", "done", "ended", "handled", "skipped", "checked",
    "schedule", "catch-up", "manual", "poll", "background", "space", "worktree"]) used.add(word);
  assert.ok(used.size > 80, `found only ${used.size} keys: the scan is broken`);
  for (const [lang] of LANGUAGES.filter(([l]) => l !== "en")) {
    const have = new Set(keys(lang));
    assert.deepEqual([...used].filter((k) => !have.has(k)), [], `${lang} lacks these`);
  }
});
