// The engine: loads bots from jobs/, decides which are due, starts them, keeps history.
// State is in shared "scheduler.*": slots (the last slot seen per bot), paused, history (the newest
// runs), next, and for code bots seen (the item keys handled) and state (each bot's own store). All
// history is kept in day files under data/herdr-scheduler/history/<bot>/, outside the mod folder (a
// write inside it reloads the mod).

import * as fs from "fs/promises";
import { hc, exec, appHome, home, shared, setShared, terminals, spaces, panes, notify, readTextFile, writeTextFile } from "herdr";
import { parse, due, next, duration, items, remember, dayFile, keepDays, expired, rows } from "./schedule.js";
import { say } from "./i18n.js";

// Notifications in the panel's language. History notes stay English and are translated when shown.
const L = (key, ...args) => say(shared("scheduler.lang"), key, ...args);

// A slot this late still runs without catchUp: a reload holds runs back for 30s.
const GRACE = 90_000;
const HISTORY = 50; // rows per bot in shared; older ones move to the day files
const KEEP = 30; // days of history kept when a bot doesn't say
const KEPT = 5; // finished background terminals kept per bot, for reading back
const going = (status) => status === "working" || status === "blocked";
const expand = (p) => (p === "~" ? home() : p.startsWith("~/") ? home() + p.slice(1) : p);
const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export const where = (w) => (w.background ? "background" : w.space != null ? "space" : "worktree");

const JOBS = () => `${appHome()}/mods/herdr-scheduler/jobs`;
const HISTORY_DIR = () => `${appHome()}/data/herdr-scheduler/history`;

// A run's where, agent and prompt (a prompt bot's, or a code bot's ctx.start), checked.
function runnable({ where: w, agent, prompt }) {
  if (!w || [w.background, w.space, w.worktree].filter((x) => x != null && x !== false).length !== 1)
    throw new Error("where needs exactly one of background, space, worktree");
  if (w.worktree && typeof w.worktree.repo !== "string") throw new Error("where.worktree needs repo");
  if (!Array.isArray(agent) || !agent.length || agent.some((a) => typeof a !== "string"))
    throw new Error('agent is a command, like ["claude", "--model", "haiku"]');
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt is missing");
}

// A bot file's default export, checked. Throws what's wrong with it. A code bot (poll and handle) is
// called through the file's own object, so its functions can use `this`.
export function check(bot) {
  if (!bot || typeof bot !== "object") throw new Error("no default export");
  if (bot.about != null && typeof bot.about !== "string") throw new Error("about is a line of text");
  const about = bot.about?.trim() || null, keep = bot.keepHistory == null ? KEEP : keepDays(bot.keepHistory);
  if (bot.poll != null || bot.handle != null) {
    if (typeof bot.poll !== "function" || typeof bot.handle !== "function") throw new Error("a code schedule needs poll and handle functions");
    if (bot.ended != null && typeof bot.ended !== "function") throw new Error("ended must be a function");
    return { schedule: parse(bot.schedule), code: true, about, keep };
  }
  runnable(bot);
  return {
    schedule: parse(bot.schedule), catchUp: bot.catchUp == null ? 0 : duration(bot.catchUp),
    where: bot.where, agent: bot.agent, prompt: bot.prompt, about, keep,
  };
}

// Every bot in jobs/, by file name. A file that fails to load or check is { name, error }.
export async function load() {
  let files = [];
  try { files = await fs.readdir(JOBS()); } catch {} // no jobs/ yet
  const bots = [];
  for (const file of files.map((f) => f.name ?? f).filter((f) => f.endsWith(".js")).sort()) {
    const name = file.slice(0, -3);
    let raw;
    try {
      raw = (await import(["./jobs/", file].join(""))).default;
      bots.push({ name, raw, ...check(raw) });
    } catch (e) { bots.push({ name, raw, error: String(e.message ?? e) }); }
  }
  // A reload forgets the rounds: today's come back from the day file.
  for (const b of bots) if (b.code) {
    try { rounds[b.name] = rows(await readTextFile(`${HISTORY_DIR()}/${b.name}/${dayFile(Date.now())}`)).filter((r) => r.round).slice(0, HISTORY); } catch {}
  }
  return bots;
}

// A code bot's file has functions, so the panel can't write it back: what the panel changes of it (its
// schedule and about line) is kept in shared "scheduler.overrides" and laid over the file's values
// here. Every copy of the mod reads through this, so a change reaches them all without a reload.
export function current(bots) {
  const over = shared("scheduler.overrides") ?? {};
  return bots.map((b) => {
    const o = b.code && over[b.name];
    if (!o) return b;
    try {
      return { ...b, schedule: parse(o.schedule), about: o.about?.trim() || null, keep: o.keepHistory == null ? b.keep : keepDays(o.keepHistory), changed: true };
    } catch { return b; } // a bad override: the file's
  });
}

// Sets what the panel changed of a code bot, or with null goes back to the file's values.
export function setOverride(name, values) {
  const { [name]: _, ...rest } = shared("scheduler.overrides") ?? {};
  setShared("scheduler.overrides", values ? { ...rest, [name]: values } : rest);
}

// Writes a bot the panel's form made, as jobs/<name>.js. The write reloads the mod, which is how
// the list picks it up. `was`: the name it had, when it is an existing one. A new name must be free;
// a changed one moves the file and what shared state keeps under the old name, so its history stays.
export async function save(name, bot, was) {
  check(bot);
  // The name is a file name and goes into terminal labels (scheduler.bot=<name>, scheduler.thread=<name>:<thread>).
  if (!/^[^./\\:=][^/\\:=]*$/.test(name)) throw new Error("a name can't have / \\ : = in it or start with a dot");
  if (name !== was && await fs.exists(`${JOBS()}/${name}.js`)) throw new Error(`a schedule named ${name} is already there`);
  await fs.mkdir(JOBS(), { recursive: true }).catch(() => {}); // already there
  if (was && name !== was) {
    await moveHistory(was, name); // before the write below, which reloads the mod
    for (const key of ["scheduler.slots", "scheduler.paused", "scheduler.seen", "scheduler.state"]) {
      const { [was]: kept, ...rest } = shared(key) ?? {};
      if (kept !== undefined) setShared(key, { ...rest, [name]: kept });
    }
    setShared("scheduler.history", (shared("scheduler.history") ?? []).map((r) => (r.bot === was ? { ...r, bot: name } : r)));
    // Its live terminals follow too, or they would stop being its own to end.
    for (const k of terminals()) if (k.state === "live" && k.labels?.["scheduler.bot"] === was) await hc(["label", k.address, `scheduler.bot=${name}`]);
  }
  await fs.writeFile(`${JOBS()}/${name}.js`, `export default ${JSON.stringify(bot, null, 2)};\n`);
  if (was && name !== was) await fs.unlink(`${JOBS()}/${was}.js`);
}

// Deletes a bot: its file and all its history. (A file that is only gone, moved away for a while, keeps
// its history until it expires.)
export async function remove(name) {
  setShared("scheduler.history", (shared("scheduler.history") ?? []).filter((r) => r.bot !== name));
  const dir = `${HISTORY_DIR()}/${name}`;
  for (const f of await list(dir)) await fs.unlink(`${dir}/${f}`);
  await fs.rmdir(dir).catch(() => {}); // none
  files.clear();
  await fs.unlink(`${JOBS()}/${name}.js`);
}

// The day files of a bot (or the bot folders, for HISTORY_DIR), none when the folder isn't there.
async function list(dir) {
  try { return (await fs.readdir(dir)).map((f) => f.name ?? f).sort(); } catch { return []; }
}

// A renamed bot's day files go to its new name, joined to what a bot of that name left there.
async function moveHistory(from, to) {
  const src = `${HISTORY_DIR()}/${from}`;
  for (const f of await list(src)) {
    const old = await fs.readFile(`${src}/${f}`, "utf8"), there = await readTextFile(`${HISTORY_DIR()}/${to}/${f}`);
    await writeTextFile(`${HISTORY_DIR()}/${to}/${f}`, (there ?? "") + old, there);
    await fs.unlink(`${src}/${f}`);
  }
  await fs.rmdir(src).catch(() => {}); // none
  files.clear();
}

// Each day file as last read or written, and one queue for every write: copies of the mod share this
// thread, so the queue keeps them in order; `expected` catches a write of an older load still landing.
const files = new Map();
let queue = Promise.resolve();

// Adds rows (without `bot`, the folder says it) to their bot's day files.
function append(bot, list) {
  const job = queue.then(async () => {
    const byFile = new Map();
    for (const { bot: _, ...r } of list) {
      const file = dayFile(r.at), line = JSON.stringify(r.note?.length > 2000 ? { ...r, note: r.note.slice(0, 2000) } : r);
      byFile.set(file, (byFile.get(file) ?? "") + line + "\n");
    }
    for (const [file, text] of byFile) {
      const path = `${HISTORY_DIR()}/${bot}/${file}`;
      // ponytail: readTextFile reads up to 1 MiB, so a day file past that can't take more rows; a day
      // of 1-minute rounds is about 140 KB. If it shows, split a day file.
      for (let tries = 0; ; tries++) {
        if (!files.has(path)) files.set(path, await readTextFile(path));
        const old = files.get(path);
        try { await writeTextFile(path, (old ?? "") + text, old); files.set(path, (old ?? "") + text); break; }
        catch (e) { files.delete(path); if (tries) throw e; } // changed under us: read it again, once
      }
    }
  });
  queue = job.catch(() => {});
  return job;
}

// Moves rows out of shared into the day files: those past a bot's newest HISTORY, and those of bots
// that are gone. Written first and dropped after, so a reload in between writes them again (reading
// drops the repeat).
let archiving = false; // copies of the mod each tick: one archive at a time, or rows are written twice
async function archive(names) {
  if (archiving) return;
  archiving = true;
  try {
    const count = {}, out = new Map();
    for (const r of shared("scheduler.history") ?? [])
      if (!names.has(r.bot) || (count[r.bot] = (count[r.bot] ?? 0) + 1) > HISTORY) out.set(r.bot, [...(out.get(r.bot) ?? []), r]);
    const done = new Set();
    for (const [bot, list] of out) {
      try { await append(bot, list); for (const r of list) done.add(r.id); } catch {} // stays in shared: next tick tries again
    }
    if (done.size) setShared("scheduler.history", (shared("scheduler.history") ?? []).filter((r) => !done.has(r.id)));
  } finally { archiving = false; }
}

// Removes day files older than each bot's keepHistory. A folder whose bot is gone keeps KEEP days,
// then goes.
let pruned = null;
async function prune(bots) {
  const today = dayFile(Date.now());
  if (pruned === today) return;
  pruned = today;
  files.clear();
  const keep = Object.fromEntries(bots.map((b) => [b.name, b.keep ?? KEEP]));
  for (const bot of await list(HISTORY_DIR())) {
    const dir = `${HISTORY_DIR()}/${bot}`, all = await list(dir), old = expired(all, keep[bot] ?? KEEP, Date.now());
    for (const f of old) await fs.unlink(`${dir}/${f}`);
    if (!(bot in keep) && old.length === all.length) await fs.rmdir(dir).catch(() => {}); // not empty: something else is in it
  }
}

// A bot's history day by day for the panel: the days there are, newest first, and one day's rows
// (with what shared still holds of that day), newest first.
export async function historyDays(name) {
  const days = new Set((await list(`${HISTORY_DIR()}/${name}`)).filter((f) => f.endsWith(".jsonl")));
  for (const r of shared("scheduler.history") ?? []) if (r.bot === name) days.add(dayFile(r.at));
  return [...days].sort().reverse();
}
export async function historyDay(name, file) {
  const own = (shared("scheduler.history") ?? []).filter((r) => r.bot === name && dayFile(r.at) === file);
  const kept = rows(await readTextFile(`${HISTORY_DIR()}/${name}/${file}`)).map((r) => ({ ...r, bot: name }));
  return rows([...kept, ...own].map((r) => JSON.stringify(r)).join("\n"));
}

// A live terminal of this bot (one it started, or one holding one of its threads) that is still
// working or waiting on someone.
export const busy = (name) => terminals().find((k) => k.state === "live" && going(k.status)
  && (k.labels?.["scheduler.bot"] === name || k.labels?.["scheduler.thread"]?.startsWith(`${name}:`)));
// Bots with a run being started or a round going, in this JS thread (copies of the mod share it, a
// reload empties it): one bot never has two at once, and a "starting" row of a bot not in here was cut off.
const active = new Set();
// Started and not through yet: "Run now" waits until it is.
export const running = (name) => active.has(name) || Boolean(busy(name));

// The bots to start now, as [bot, trigger]. The slot is written before anything is awaited, so of
// several copies of the mod only one starts it.
export function tick(bots, now = Date.now()) {
  const slots = {}, seen = shared("scheduler.slots") ?? {}, paused = shared("scheduler.paused") ?? {};
  const todo = [], missed = [];
  for (const b of bots) {
    slots[b.name] = seen[b.name];
    if (b.error) continue;
    const d = due(b.schedule, seen[b.name], now, Math.max(GRACE, b.catchUp));
    if (!d) continue;
    slots[b.name] = d.slot;
    if (d.first || paused[b.name]) continue;
    if (b.code) { todo.push([b, "schedule"]); continue; } // a round is safe to repeat: a late slot runs, none is missed
    if (running(b.name)) continue; // a run still going: this slot is skipped
    if (d.run) todo.push([b, d.late > GRACE ? "catch-up" : "schedule"]);
    else missed.push({ id: hex(8), bot: b.name, at: d.slot, trigger: "schedule", where: where(b.where), status: "missed" });
  }
  if (JSON.stringify(slots) !== JSON.stringify(seen)) setShared("scheduler.slots", slots);
  forget(new Set(bots.map((b) => b.name)));
  if (missed.length) record(...missed);
  // For other mods (a sidebar countdown): when each bot runs next.
  const upcoming = Object.fromEntries(bots.filter((b) => !b.error && !paused[b.name]).map((b) => [b.name, next(b.schedule, now)]));
  if (JSON.stringify(upcoming) !== JSON.stringify(shared("scheduler.next") ?? {})) setShared("scheduler.next", upcoming);
  return todo;
}

// Drops what deleted bots left in shared: their seen keys, state and pause (their history moves to
// the day files, in archive). Not with no bots at all, which is also what a jobs/ folder that couldn't
// be read looks like.
function forget(names) {
  if (!names.size) return;
  for (const key of ["scheduler.seen", "scheduler.state", "scheduler.paused", "scheduler.overrides"]) {
    const all = Object.entries(shared(key) ?? {}), own = all.filter(([name]) => names.has(name));
    if (own.length !== all.length) setShared(key, Object.fromEntries(own));
  }
}

function record(...rows) {
  setShared("scheduler.history", [...rows, ...(shared("scheduler.history") ?? [])]);
}

function patch(id, fields) {
  setShared("scheduler.history", (shared("scheduler.history") ?? []).map((r) => (r.id === id ? { ...r, ...fields } : r)));
}

export function setPaused(name, on) {
  const { [name]: _, ...rest } = shared("scheduler.paused") ?? {};
  setShared("scheduler.paused", on ? { ...rest, [name]: true } : rest);
}

async function git(args, cwd) {
  const r = await exec("git", args, { cwd, timeout: 120_000 });
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim() || r.stdout.trim()}`);
}

// The checkout for a worktree bot, made if it isn't there: ~/.herdr/worktrees/<repo>/<name>, where
// Herdr's own worktree mod puts them. `commit` (any rev: "origin/main") is fetched and checked out
// detached on every run; `branch` is created from the repo's HEAD if new and then left alone.
async function checkout(w, bot) {
  const repo = expand(w.repo), name = (w.name ?? bot).replace(/\//g, "-");
  const path = `${home()}/.herdr/worktrees/${repo.split("/").filter(Boolean).pop()}/${name}`;
  const exists = await fs.readdir(path).then(() => true, () => false);
  if (w.commit) {
    await git(["fetch", "--quiet"], repo);
    await (exists ? git(["checkout", "--detach", w.commit], path) : git(["worktree", "add", "--detach", path, w.commit], repo));
  } else if (!exists) {
    const branch = w.branch ?? name;
    const has = (await exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo })).code === 0;
    await git(has ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path], repo);
  }
  return path;
}

// Where a run starts and the labels that put it there. A terminal labelled herdr.space and herdr.tab
// shows up in that space as that tab (ids Herdr doesn't know become new ones) without taking focus.
async function place(w, bot) {
  const tab = `herdr.tab=tb${hex(32)}`;
  const inSpace = (s) => panes().find((p) => p.cwd && s.tabs.some((c) => c.id === p.tab));
  if (w.background) return { cwd: expand(w.cwd ?? "~"), labels: [] };
  if (w.space != null) {
    const s = spaces().find((s) => !s.machine && (s.id === w.space || s.name === w.space));
    if (!s) throw new Error(`no space "${w.space}" on this machine`);
    return { cwd: w.cwd ? expand(w.cwd) : inSpace(s)?.cwd ?? (s.folder || home()), labels: [`herdr.space=${s.id}`, tab] };
  }
  const path = await checkout(w.worktree, bot);
  const open = spaces().find((s) => !s.machine && inSpace(s)?.cwd.startsWith(path));
  return { cwd: path, labels: [`herdr.space=${open?.id ?? `sp${hex(32)}`}`, tab] };
}

// Before a background run: any idle agent of this bot that tidy() hasn't ended yet goes (not one
// holding a code bot's thread), and of the ended ones only the newest KEPT stay readable.
async function reap(bot) {
  for (const k of terminals())
    if (k.state === "live" && k.labels?.["scheduler.bot"] === bot && !k.labels["herdr.tab"] && !k.labels["scheduler.thread"] && !going(k.status))
      await hc(["kill", k.address]);
  const old = (shared("scheduler.history") ?? []).filter((r) => r.bot === bot && r.where === "background" && r.terminal && !r.removed).slice(KEPT);
  for (const r of old) if ((await hc(["rm", r.terminal])).code === 0) patch(r.id, { removed: true }); // a live one stays for later
}

// Ends background agents that are through. An agent with no tab is a program holding memory that
// nobody sees, so it goes as soon as its turn is over: its row is marked done first, and its last
// screen stays readable from the history. One waiting on the person stays, and so does one holding a
// thread (its conversation is continued). The agents of schedules that are gone go too, with their
// terminals. Not with no schedules at all, which is also what an unreadable jobs/ folder looks like.
export async function tidy(bots) {
  const names = new Set(bots.map((b) => b.name));
  if (!names.size) return;
  await archive(names);
  await prune(bots);
  for (const k of terminals()) {
    const bot = k.labels?.["scheduler.bot"];
    if (k.state !== "live" || !bot || k.labels["herdr.tab"] || k.labels["scheduler.thread"] || going(k.status)) continue;
    if (!names.has(bot)) { await hc(["kill", k.address]); await hc(["rm", k.address]); continue; }
    // Its prompt was sent and a turn has ended: not one still waiting for its prompt.
    const row = (shared("scheduler.history") ?? []).find((r) => r.id === k.labels["scheduler.run"] && r.terminal === k.address);
    if (row?.status !== "sent" || !(k.turn >= 1)) continue;
    patch(row.id, { status: "done" });
    await hc(["kill", k.address]);
  }
}

// Waits until the agent takes input: `hc wait` returns once it reports idle. Short waits in a loop,
// since a call may not outlive exec's default timeout.
async function ready(terminal) {
  for (let i = 0; i < 6; i++) {
    const r = await hc(["wait", terminal, "--timeout", "20", "--json"]);
    let w = {};
    try { w = JSON.parse(r.stdout); } catch {}
    if (w.status === "idle" || w.status === "done") return;
    if (w.status === "blocked") throw new Error("the agent asked something before taking the prompt (a trust or permission dialog)");
    if (w.exit_code != null || w.reason === "exit") throw new Error("the agent exited before taking the prompt");
    // Claude's folder trust question reports no status, so only its screen tells.
    if (/trust this folder/i.test((await hc(["read", terminal, "--lines", "40"])).stdout))
      throw new Error("the agent asks whether to trust its folder: trust it once by hand, or give the run a cwd it trusts");
  }
  throw new Error("the agent wasn't ready after 2 minutes");
}

// Starts an agent for history row `id`: in its place, then the prompt once it takes input. (A prompt
// passed in argv is typed but not sent.) Resolves with the terminal's address; throws the reason.
async function launch(bot, { where: w, agent, prompt }, id, labels = []) {
  if (w.background) await reap(bot);
  const placed = await place(w, bot);
  const made = await hc(["run", "--bg", "--no-parent", "--json", "--cwd", placed.cwd,
    ...[`scheduler.bot=${bot}`, `scheduler.run=${id}`, ...labels, ...placed.labels].flatMap((l) => ["--label", l]), "--", ...agent]);
  if (made.code !== 0) throw new Error(made.stderr.trim() || made.stdout.trim());
  const terminal = JSON.parse(made.stdout).address;
  patch(id, { terminal });
  // An agent that never took its prompt is ended: its row's last screen shows where it stopped.
  try { await ready(terminal); } catch (e) { await hc(["kill", terminal]); throw e; }
  const sent = await hc(["send", terminal, prompt, "--if", "idle", "--json"]);
  if (sent.code !== 0) throw new Error(`the prompt wasn't sent: ${sent.stderr.trim() || sent.stdout.trim()}`);
  patch(id, { status: "sent" });
  return terminal;
}

// Starts a bot: a prompt bot's run, or a code bot's round. Never throws: a failure is a history row
// and a notification.
export async function start(bot, trigger) {
  if (active.has(bot.name)) return;
  active.add(bot.name);
  try {
    if (bot.code) return await round(bot, trigger);
    const id = hex(8);
    record({ id, bot: bot.name, at: Date.now(), trigger, where: where(bot.where), status: "starting" });
    try {
      await launch(bot.name, bot, id);
    } catch (e) {
      const note = String(e.message ?? e);
      patch(id, { status: "failed", note });
      notify({ title: L("{0} didn't start", bot.name), body: L(note), level: "error" });
    }
  } finally { active.delete(bot.name); }
}

// Each code bot's rounds, newest first: { id, at, trigger, round: true, status: "checked", items, fresh }
// or status "failed" with the note. A round goes to the day file and stays here, not in shared: a
// setShared every round would redraw every mod. load() brings today's back after a reload.
const rounds = {};
export const roundsOf = (name) => rounds[name] ?? [];
function noteRound(bot, row) {
  rounds[bot] = [row, ...roundsOf(bot)].slice(0, HISTORY);
  append(bot, [row]).catch(() => {}); // ponytail: a round line that can't be written is only in memory
}

// A code bot's round: `ended` for each live terminal holding one of its threads (true lets it go),
// then `poll`, then `handle` for each item whose key is new, while the bot isn't busy. Run now
// (trigger "manual") also hands an item whose last row failed to handle again. Every round is a line.
async function round(bot, trigger) {
  const at = Date.now(), manual = trigger === "manual";
  try {
    const raw = bot.raw, prefix = `${bot.name}:`;
    if (raw.ended) for (const k of terminals()) {
      const thread = k.labels?.["scheduler.thread"];
      if (k.state !== "live" || !thread?.startsWith(prefix)) continue;
      if (await raw.ended(thread.slice(prefix.length), api(bot.name))) await hc(["label", k.address, "scheduler.thread="]);
    }
    const found = items(await raw.poll(api(bot.name)));
    let fresh = 0;
    for (const item of found) {
      if (busy(bot.name)) break; // the rest wait, unseen, for a later round
      // The key is written before anything is awaited, so of several copies of the mod only one handles it.
      const seen = shared("scheduler.seen") ?? {};
      const failed = manual && (shared("scheduler.history") ?? []).find((r) => r.bot === bot.name && r.item === item.key)?.status === "failed";
      if (seen[bot.name]?.[item.key] != null && !failed) continue;
      setShared("scheduler.seen", { ...seen, [bot.name]: remember(seen[bot.name] ?? {}, item.key, Date.now()) });
      fresh++;
      if (await handle(bot, item)) break; // an agent just got work, and may not report working yet
    }
    noteRound(bot.name, { id: hex(8), at, trigger, round: true, status: "checked", items: found.length, fresh });
  } catch (e) {
    // A poll or ended failing every round notifies once, until the message changes.
    const note = String(e.message ?? e), last = roundsOf(bot.name)[0];
    if (last?.status !== "failed" || last.note !== note) notify({ title: L("{0} failed", bot.name), body: L(note), level: "error" });
    noteRound(bot.name, { id: hex(8), at, trigger, round: true, status: "failed", note });
  }
}

// One item: its history row, then the bot's handle. A row that got no terminal and no skip reads
// "handled". True when ctx.start or ctx.send gave an agent work.
async function handle(bot, item) {
  const id = hex(8);
  record({ id, bot: bot.name, at: Date.now(), trigger: "poll", item: item.key, status: "starting" });
  try {
    await bot.raw.handle(item, api(bot.name, id));
    const status = (shared("scheduler.history") ?? []).find((r) => r.id === id)?.status;
    if (status === "starting") patch(id, { status: "handled" });
    return status === "sent";
  } catch (e) {
    const note = String(e.message ?? e);
    patch(id, { status: "failed", note });
    notify({ title: L("{0} failed on {1}", bot.name, item.key), body: L(note), level: "error" });
  }
}

// A code bot's ctx: all it may use. `row`: the history row of the item being handled (none in poll
// and ended, where start and send aren't offered).
function api(bot, row) {
  const own = (thread) => `${bot}:${thread}`;
  const handling = (what) => { if (!row) throw new Error(`ctx.${what} works in handle only`); };
  return {
    home: home(), exec, notify, spaces, panes, terminals,
    thread: (name) => terminals().find((k) => k.state === "live" && k.labels?.["scheduler.thread"] === own(name))?.address ?? null,
    async start(run) {
      handling("start");
      runnable(run);
      patch(row, { where: where(run.where) });
      return launch(bot, run, row, run.thread == null ? [] : [`scheduler.thread=${own(run.thread)}`]);
    },
    // The row follows the terminal from now on; its earlier rows read "ended".
    async send(terminal, text) {
      handling("send");
      const r = await hc(["send", terminal, text]);
      if (r.code !== 0) throw new Error(`not sent to ${terminal}: ${r.stderr.trim() || r.stdout.trim()}`);
      await hc(["label", terminal, `scheduler.run=${row}`]);
      patch(row, { terminal, where: panes().some((p) => p.terminal === terminal) ? "space" : "background", status: "sent" });
    },
    skip(item, why) {
      if (row) return patch(row, { status: "skipped", note: String(why) });
      record({ id: hex(8), bot, at: Date.now(), trigger: "poll", item: item?.key == null ? undefined : String(item.key), status: "skipped", note: String(why) });
    },
    state: {
      get: (key) => (shared("scheduler.state") ?? {})[bot]?.[key],
      // undefined removes the key. Written only when it changes: every setShared redraws every mod.
      set(key, value) {
        const all = shared("scheduler.state") ?? {}, { [key]: old, ...rest } = all[bot] ?? {};
        if (JSON.stringify(old) === JSON.stringify(value)) return;
        setShared("scheduler.state", { ...all, [bot]: value === undefined ? rest : { ...rest, [key]: value } });
      },
    },
  };
}

// A history row's state now: what was recorded, or what its terminal is doing.
export function state(row) {
  // A code item's row is "starting" while its handle runs, which is the script's work: "running".
  if (row.status === "starting") return !active.has(row.bot) ? "interrupted" : row.trigger === "poll" ? "running" : "starting";
  if (row.status !== "sent") return row.status; // failed, missed, handled, skipped, done (ended by tidy)
  const k = terminals().find((k) => k.address === row.terminal && k.labels?.["scheduler.run"] === row.id);
  if (!k || k.state !== "live") return "ended";
  return k.status === "working" ? "running" : k.status === "blocked" ? "blocked" : "done";
}
