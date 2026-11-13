// The engine: loads bots from jobs/, decides which are due, starts them, keeps history.
// State is in shared "scheduler.*": slots (the last slot seen per bot), paused, history, next, and for
// code bots seen (the item keys handled) and state (each bot's own store).

import * as fs from "fs/promises";
import { hc, exec, appHome, home, shared, setShared, terminals, spaces, panes, notify } from "herdr";
import { parse, due, next, duration, items, remember } from "./schedule.js";
import { say } from "./i18n.js";

// Notifications in the panel's language. History notes stay English and are translated when shown.
const L = (key, ...args) => say(shared("scheduler.lang"), key, ...args);

// A slot this late still runs without catchUp: a reload holds runs back for 30s.
const GRACE = 90_000;
const HISTORY = 50; // rows kept per bot
const KEPT = 5; // finished background terminals kept per bot, for reading back
const going = (status) => status === "working" || status === "blocked";
const expand = (p) => (p === "~" ? home() : p.startsWith("~/") ? home() + p.slice(1) : p);
const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export const where = (w) => (w.background ? "background" : w.space != null ? "space" : "worktree");

const JOBS = () => `${appHome()}/mods/herdr-scheduler/jobs`;

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
  const about = bot.about?.trim() || null;
  if (bot.poll != null || bot.handle != null) {
    if (typeof bot.poll !== "function" || typeof bot.handle !== "function") throw new Error("a code schedule needs poll and handle functions");
    if (bot.ended != null && typeof bot.ended !== "function") throw new Error("ended must be a function");
    return { schedule: parse(bot.schedule), code: true, about };
  }
  runnable(bot);
  return {
    schedule: parse(bot.schedule), catchUp: bot.catchUp == null ? 0 : duration(bot.catchUp),
    where: bot.where, agent: bot.agent, prompt: bot.prompt, about,
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
    try { return { ...b, schedule: parse(o.schedule), about: o.about?.trim() || null, changed: true }; } catch { return b; } // a bad override: the file's
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

export const remove = (name) => fs.unlink(`${JOBS()}/${name}.js`);

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

// Drops what deleted bots left in shared: their history, seen keys, state and pause. Not with no
// bots at all, which is also what a jobs/ folder that couldn't be read looks like.
function forget(names) {
  if (!names.size) return;
  const history = shared("scheduler.history") ?? [], kept = history.filter((r) => names.has(r.bot));
  if (kept.length !== history.length) setShared("scheduler.history", kept);
  for (const key of ["scheduler.seen", "scheduler.state", "scheduler.paused", "scheduler.overrides"]) {
    const all = Object.entries(shared(key) ?? {}), own = all.filter(([name]) => names.has(name));
    if (own.length !== all.length) setShared(key, Object.fromEntries(own));
  }
}

function record(...rows) {
  const count = {};
  setShared("scheduler.history", [...rows, ...(shared("scheduler.history") ?? [])]
    .filter((r) => (count[r.bot] = (count[r.bot] ?? 0) + 1) <= HISTORY));
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
    if (bot.code) return await round(bot, trigger === "manual");
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

// What each code bot's last round found, { at, items, fresh } or { at, error }: a round with nothing
// new leaves no history row, so this is how the panel shows it ran. In memory: a reload forgets it.
const checked = {};
export const lastRound = (name) => checked[name];

// A code bot's round: `ended` for each live terminal holding one of its threads (true lets it go),
// then `poll`, then `handle` for each item whose key is new, while the bot isn't busy. `manual` (Run
// now) also hands an item whose last row failed to handle again.
async function round(bot, manual) {
  try {
    const raw = bot.raw, prefix = `${bot.name}:`;
    if (raw.ended) for (const k of terminals()) {
      const thread = k.labels?.["scheduler.thread"];
      if (k.state !== "live" || !thread?.startsWith(prefix)) continue;
      if (await raw.ended(thread.slice(prefix.length), api(bot.name))) await hc(["label", k.address, "scheduler.thread="]);
    }
    const found = items(await raw.poll(api(bot.name)));
    // A poll that works again ends the failure the newest row reports (a round with nothing new adds no row).
    const last = (shared("scheduler.history") ?? []).find((r) => r.bot === bot.name);
    if (last?.status === "failed" && last.item == null && !last.recovered) patch(last.id, { recovered: true });
    checked[bot.name] = { at: Date.now(), items: found.length, fresh: 0 };
    for (const item of found) {
      if (busy(bot.name)) break; // the rest wait, unseen, for a later round
      // The key is written before anything is awaited, so of several copies of the mod only one handles it.
      const seen = shared("scheduler.seen") ?? {};
      const failed = manual && (shared("scheduler.history") ?? []).find((r) => r.bot === bot.name && r.item === item.key)?.status === "failed";
      if (seen[bot.name]?.[item.key] != null && !failed) continue;
      setShared("scheduler.seen", { ...seen, [bot.name]: remember(seen[bot.name] ?? {}, item.key, Date.now()) });
      checked[bot.name].fresh++;
      if (await handle(bot, item)) break; // an agent just got work, and may not report working yet
    }
  } catch (e) {
    // A poll or ended failing every round is one row and one notification until the message changes.
    const note = String(e.message ?? e), last = (shared("scheduler.history") ?? []).find((r) => r.bot === bot.name);
    checked[bot.name] = { at: Date.now(), error: note };
    if (last?.status !== "failed" || last.note !== note || last.recovered) {
      record({ id: hex(8), bot: bot.name, at: Date.now(), trigger: "poll", status: "failed", note });
      notify({ title: L("{0} failed", bot.name), body: L(note), level: "error" });
    }
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
