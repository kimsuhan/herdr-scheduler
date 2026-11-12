// Scheduler: bots that give an agent a prompt on a schedule, or run code that polls for items. A bot
// is a file in this mod's jobs/ folder (see examples/). This panel lists them, runs or pauses one, and
// shows each one's history.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { hc, run, theme, settings, shared, spaces, pickFolder, props } from "herdr";
import { load, tick, start, state, busy, where, setPaused, check, save, remove, lastRound } from "./engine.js";
import { describe, next } from "./schedule.js";

const TICK = 30_000;
const REPEATS = [["daily", "Daily"], ["weekdays", "Weekdays"], ["days", "Days"], ["every", "Every"]];
const PLACES = [["background", "Background"], ["space", "Space"], ["worktree", "Worktree"]];
const DAYS = [[1, "Mo"], [2, "Tu"], [3, "We"], [4, "Th"], [5, "Fr"], [6, "Sa"], [0, "Su"]];
const pad2 = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function until(ms) {
  const m = Math.floor((ms - Date.now()) / 60_000);
  if (m < 1) return "in <1m";
  if (m < 60) return `in ${m}m`;
  if (m < 1440) return `in ${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
  return `in ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`;
}

export default class Scheduler extends View {
  init(_props, cx) {
    this.bots = null; // from jobs/, null while loading
    this.open = null; // the bot whose detail is shown
    this.output = null; // { id, text }: an ended run's screen, read back
    this.form = null; // the new or edit form's fields, while it is shown
    cx.spawn(async (cx) => { this.bots = await load(); cx.notify(); });
    // The first tick is a full TICK after a load: saving a file reloads the mod, and that shouldn't fire runs.
    cx.timer.every(TICK, (cx) => {
      if (!this.bots) return;
      for (const [bot, trigger] of tick(this.bots)) this.go(bot, trigger, cx);
      cx.notify(); // the countdowns
    });
  }

  // Starts a bot and redraws when it is through: a code bot's round may change nothing but its "checked" line.
  go(bot, trigger, cx) { cx.spawn(async (cx) => { await start(bot, trigger); cx.notify(); }); }

  // "checked 2m ago: 3 items, 0 new" for a code bot's last round, or null before its first.
  checked(b) {
    const c = lastRound(b.name);
    return c ? `checked ${ago(c.at)}: ${c.error ? "failed" : `${c.items} ${c.items === 1 ? "item" : "items"}, ${c.fresh} new`}` : null;
  }

  history(name) { return (shared("scheduler.history") ?? []).filter((r) => r.bot === name); }

  // A run's terminal if it is still there: a background one is peeked at, a pane is gone to.
  // An ended one's last screen is read back into the panel.
  show(row, cx) {
    const s = state(row);
    if (!row.terminal || s === "starting") return;
    if (s === "running" || s === "blocked" || s === "done")
      return run(row.where === "background" ? "terminal.peek" : "pane.focus", { terminal: row.terminal });
    if (this.output?.id === row.id) { this.output = null; return cx.notify(); }
    cx.spawn(async (cx) => {
      const r = row.removed ? { code: 1 } : await hc(["read", row.terminal, "--lines", "200"]);
      const text = r.code === 0 ? r.stdout.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim() : "";
      this.output = { id: row.id, text: text || "This run's terminal is gone." };
      cx.notify();
    });
  }

  // The form, for a new bot or one whose file is plain data (no functions, so it can be written back).
  edit(bot, cx) {
    const r = bot?.raw ?? { schedule: { weekdays: "09:00" }, where: { background: true }, agent: ["claude"], prompt: "" };
    const s = r.schedule ?? {}, w = r.where ?? {};
    const input = (value, placeholder) => {
      const state = InputState.new({ placeholder, value: value ?? "" });
      state.on("change", (_e, cx) => cx.notify()); // the problem line follows what is typed
      return state;
    };
    this.form = {
      original: bot?.name ?? null, problem: null,
      repeat: s.every != null ? "every" : s.daily != null ? "daily" : s.days ? "days" : "weekdays", days: s.days ?? [1],
      place: w.space != null ? "space" : w.worktree ? "worktree" : "background", space: w.space ?? "",
      rev: w.worktree?.branch != null ? "branch" : "commit", folder: w.worktree?.name,
      name: input(bot?.name, "dependency-check"), time: input(s.daily ?? s.weekdays ?? s.at ?? "09:00", "09:00"),
      every: input(s.every ?? "30m", "30m"), catchUp: input(r.catchUp, "none, or 2h"), cwd: input(w.cwd, "~"),
      about: input(r.about, "optional: what this bot is for"),
      repo: input(w.worktree?.repo, "~/code/my-repo"), ref: input(w.worktree?.commit ?? w.worktree?.branch, "origin/main"),
      agent: input((r.agent ?? []).join(" "), "claude --model haiku"),
      prompt: TextareaState.new({ placeholder: "What the agent is told on every run", value: r.prompt ?? "" }),
    };
    this.form.prompt.set_auto_grow(4, 12);
    this.form.prompt.on("change", (_e, cx) => cx.notify());
    cx.notify();
  }

  // The form as a bot file's default export.
  entry() {
    const f = this.form, v = (state) => state.value().trim(), time = v(f.time);
    return {
      ...(v(f.about) ? { about: v(f.about) } : {}),
      schedule: f.repeat === "every" ? { every: v(f.every) } : f.repeat === "days" ? { days: [...f.days].sort(), at: time } : { [f.repeat]: time },
      ...(v(f.catchUp) ? { catchUp: v(f.catchUp) } : {}),
      where: f.place === "space" ? { space: f.space }
        : f.place === "worktree" ? { worktree: { repo: v(f.repo), [f.rev]: v(f.ref), ...(f.folder ? { name: f.folder } : {}) } }
        : { background: true, ...(v(f.cwd) ? { cwd: v(f.cwd) } : {}) },
      agent: v(f.agent).split(/\s+/).filter(Boolean),
      prompt: f.prompt.value(),
    };
  }

  // What keeps the form from being saved, or null.
  problem() {
    const f = this.form, bot = this.entry();
    if (!f.name.value().trim()) return "name is missing";
    if (f.place === "space" && !f.space) return "pick a space";
    if (f.place === "worktree" && !bot.where.worktree[f.rev]) return `${f.rev} is missing`;
    try { check(bot); } catch (e) { return String(e.message ?? e); }
    return f.problem;
  }

  render() {
    // A copy that only runs the bots, for a layout whose panel isn't always shown (a mod starts the
    // first time it shows): put it in a floating block, which draws nothing when empty.
    if (props()?.headless) return div();
    const t = theme();
    if (this.form) return this.card(t, this.form.original ? `Edit ${this.form.original}` : "New bot", this.renderForm(t), (cx) => { this.form = null; cx.notify(); });
    const bot = this.open && this.bots?.find((b) => b.name === this.open);
    return this.card(t, bot ? bot.name : "Scheduler", bot ? this.detail(bot, t) : this.list(t),
      bot && ((cx) => { this.open = null; this.output = null; cx.notify(); }));
  }

  // The panel: a header with a title (a back button when `back`), and a scrolling body.
  card(t, title, body, back) {
    return v_flex().id("scheduler").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(back), (el) => el.child(this.button("back", "‹", t, back)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
        .when(!back && Boolean(this.bots), (el) => el
          .child(div().text_size(11).text_color(t.dim).child(`${this.bots.length} ${this.bots.length === 1 ? "bot" : "bots"}`))
          .child(this.button("new", "+", t, (cx) => this.edit(null, cx)))))
      .child(div().id("scheduler-body").flex_1().min_h(0).overflow_y_scrollbar().child(body));
  }

  pills(id, options, value, t, pick) {
    return h_flex().flex_wrap().gap(5).children(options.map(([v, label]) => {
      const on = Array.isArray(value) ? value.includes(v) : v === value;
      return h_flex().id(`${id}-${v}`).h(24).px(8).items_center().rounded(6).text_size(12).cursor_pointer()
        .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted)
        .border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { pick(v); this.form.problem = null; cx.notify(); }).child(label);
    }));
  }

  renderForm(t) {
    const f = this.form, problem = this.problem();
    const label = (text) => div().pt(6).text_size(11).font_semibold().text_color(t.dim).child(text);
    const input = (id, state) => div().id(id).h(30).px(9).flex().items_center().rounded(7).border_1().border_color(t.input).bg(t.surface)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(state).h_full().w_full().text_size(12));
    const folder = (id, state, prompt) => h_flex().gap(6).child(div().flex_1().child(input(id, state)))
      .child(this.button(`${id}-pick`, "Choose…", t, (cx) => cx.spawn(async (cx) => {
        const dir = await pickFolder({ prompt });
        if (dir) state.set_value(dir);
        cx.notify();
      })));
    return v_flex().p(14).gap(4)
      .when(!f.original, (el) => el.child(label("Name")).child(input("f-name", f.name)))
      .child(label("About")).child(input("f-about", f.about))
      .child(label("Repeat")).child(this.pills("f-repeat", REPEATS, f.repeat, t, (v) => { f.repeat = v; }))
      .when(f.repeat === "days", (el) => el.child(this.pills("f-day", DAYS, f.days, t,
        (d) => { f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d]; })))
      .when(f.repeat === "every", (el) => el.child(label("Interval (5m, 2h, 1d)")).child(div().w(100).child(input("f-every", f.every))))
      .when(f.repeat !== "every", (el) => el.child(label("Time (24h)")).child(div().w(100).child(input("f-time", f.time)))
        .child(label("Catch up a missed run within")).child(div().w(100).child(input("f-catchup", f.catchUp))))
      .child(label("Where")).child(this.pills("f-place", PLACES, f.place, t, (v) => { f.place = v; }))
      .when(f.place === "background", (el) => el.child(label("Folder")).child(folder("f-cwd", f.cwd, "Run here")))
      .when(f.place === "space", (el) => el.child(this.pills("f-space", spaces().filter((s) => !s.machine).map((s) => [s.name, s.name]), f.space, t, (v) => { f.space = v; })))
      .when(f.place === "worktree", (el) => el.child(label("Repository")).child(folder("f-repo", f.repo, "This repository"))
        .child(label("Check out")).child(h_flex().gap(6).items_center()
          .child(this.pills("f-rev", [["commit", "Commit"], ["branch", "Branch"]], f.rev, t, (v) => { f.rev = v; }))
          .child(div().flex_1().child(input("f-ref", f.ref)))))
      .child(label("Agent command")).child(input("f-agent", f.agent))
      .child(label("Prompt")).child(div().id("f-prompt").p(8).rounded(7).border_1().border_color(t.input)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(f.prompt).w_full().text_size(12)))
      .child(div().pt(8).min_h(26).text_size(12).text_color(t.ansi1).child(problem ?? ""))
      .child(h_flex().gap(8).justify_end()
        .child(this.button("f-cancel", "Cancel", t, (cx) => { this.form = null; cx.notify(); }))
        .child(this.button("f-save", "Save", t, (cx) => {
          if (problem) return;
          cx.spawn(async (cx) => {
            // On success the write reloads the mod, and the list comes back with the bot in it.
            try { await save(f.original ?? f.name.value().trim(), this.entry(), !f.original); }
            catch (e) { f.problem = String(e.message ?? e); cx.notify(); }
          });
        }, true)));
  }

  button(id, label, t, onClick, solid) {
    return h_flex().id(id).h(24).px(8).flex_none().items_center().justify_center().rounded(7).text_size(12)
      .bg(solid ? t.solid : t.raised).text_color(solid ? t.solid_foreground : t.foreground)
      .border_1().border_color(solid ? t.solid : t.border).cursor_pointer().hover((s) => s.opacity(0.85))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onClick(cx)).child(label);
  }

  // What a bot is doing, as a word and a color.
  status(b, t) {
    if (b.error) return ["broken", t.ansi1];
    const live = busy(b.name), last = this.history(b.name)[0], s = last && state(last);
    if (live) return live.status === "blocked" ? ["blocked", t.blocked] : ["running", t.working];
    if ((shared("scheduler.paused") ?? {})[b.name]) return ["paused", t.dim];
    if (s === "failed" || s === "missed" || s === "interrupted") return [s, t.ansi1];
    return [null, t.idle];
  }

  list(t) {
    if (!this.bots) return div().p(14).text_color(t.dim).child("Loading…");
    if (!this.bots.length) return v_flex().p(14).gap(6).text_size(12).text_color(t.muted)
      .child(div().text_color(t.foreground).child("No bots yet."))
      .child("A bot is one JS file. Copy one from mods/herdr-scheduler/examples/ to mods/herdr-scheduler/jobs/ and edit it; it shows up here when saved.");
    return v_flex().py(6).children(this.bots.map((b) => {
      const [word, color] = this.status(b, t), last = this.history(b.name)[0];
      const sub = b.error ?? [describe(b.schedule), word ?? until(next(b.schedule, Date.now()))].join(" · ");
      return v_flex().id(`bot-${b.name}`).mx(8).px(8).py(7).gap(2).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.open = b.name; this.output = null; cx.notify(); })
        .child(h_flex().gap(7).items_center()
          .child(div().size(8).rounded(4).flex_none().bg(color))
          .child(div().flex_1().min_w(0).truncate().font_semibold().child(b.name))
          .when(!b.error, (el) => el.child(this.button(`run-${b.name}`, "▶", t, (cx) => this.go(b, "manual", cx)))))
        .child(div().pl(15).text_size(11).text_color(b.error ? t.ansi1 : t.muted).child(sub))
        .when(!b.error, (el) => el.child(div().pl(15).text_size(11).text_color(t.dim).truncate()
          .child((b.code ? ["code bot", this.checked(b)] : [b.agent.join(" "), where(b.where), last && `last ${ago(last.at)}`]).filter(Boolean).join(" · "))));
    }));
  }

  detail(b, t) {
    // A file that is plain data can go through the form; one with functions is edited as a file.
    const plain = b.raw && typeof b.raw === "object" && !Object.values(b.raw).some((v) => typeof v === "function");
    const manage = [
      ...(plain ? [this.button("d-edit", "Edit", t, (cx) => this.edit(b, cx))] : []),
      this.button("d-rm", this.deleting === b.name ? "Really delete" : "Delete", t, (cx) => {
        if (this.deleting !== b.name) { this.deleting = b.name; return cx.notify(); }
        cx.spawn(() => remove(b.name)); // the mod reloads without it
      }),
    ];
    if (b.error) return v_flex().p(14).gap(10).child(h_flex().gap(6).children(manage))
      .child(div().text_size(12).text_color(t.ansi1).child(b.error));
    const paused = Boolean((shared("scheduler.paused") ?? {})[b.name]), rows = this.history(b.name);
    const w = b.where ?? {}, place = w.background ? `background, ${w.cwd ?? "~"}` : w.space != null ? `space ${w.space}`
      : w.worktree && `worktree ${w.worktree.name ?? b.name} of ${w.worktree.repo}`;
    const kv = (k, v) => h_flex().gap(8).text_size(12).child(div().w(64).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).truncate().child(v));
    const tone = { running: t.working, blocked: t.blocked, done: t.ansi2, handled: t.ansi2, failed: t.ansi1, missed: t.ansi1, interrupted: t.ansi1 };
    return v_flex().p(14).gap(10)
      .child(h_flex().gap(6)
        .child(this.button("d-run", "Run now", t, (cx) => this.go(b, "manual", cx), true))
        .child(this.button("d-pause", paused ? "Resume" : "Pause", t, () => setPaused(b.name, !paused)))
        .children(manage))
      .when(Boolean(b.about), (el) => el.child(div().text_size(12).text_color(t.muted).child(b.about)))
      .child(v_flex().gap(4)
        .child(kv("Schedule", `${describe(b.schedule)}${b.catchUp ? `, catches up within ${b.catchUp / 60_000}m` : ""}`))
        .child(kv("Next", paused ? "paused" : until(next(b.schedule, Date.now()))))
        .when(!b.code, (el) => el.child(kv("Where", place)).child(kv("Agent", b.agent.join(" "))))
        .when(b.code, (el) => el.child(kv("Runs", `code: poll, handle${b.raw.ended ? ", ended" : ""}`))
          .child(kv("Checked", this.checked(b)?.slice(8) ?? "not since the last reload"))))
      .when(!b.code, (el) => el.child(div().p(8).rounded(7).bg(t.raised).text_size(12).text_color(t.muted).child(b.prompt)))
      .child(div().pt(4).text_size(11).font_semibold().text_color(t.dim).child("History"))
      .children(rows.length ? rows.flatMap((r) => {
        const s = state(r);
        return [h_flex().id(`h-${r.id}`).gap(8).px(6).py(4).rounded(6).items_center().cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => this.show(r, cx))
          .child(div().w(70).flex_none().text_size(11).text_color(tone[s] ?? t.muted).child(s))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child([r.item, r.note].filter(Boolean).join(": ") || r.trigger))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(r.at))),
        ...(this.output?.id === r.id ? [div().p(8).rounded(7).bg(t.raised).text_size(11).text_color(t.muted)
          .font_family(settings().font_family ?? "JetBrains Mono").child(this.output.text)] : [])];
      }) : [div().text_size(12).text_color(t.dim).child("No runs yet.")]);
  }
}
