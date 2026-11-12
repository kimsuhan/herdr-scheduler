// Scheduler: bots that give an agent a prompt on a schedule, or run code that polls for items. A bot
// is a file in this mod's jobs/ folder (see examples/). This panel lists them, runs or pauses one, and
// shows each one's history.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { hc, run, theme, settings, shared, setShared, spaces, pickFolder, props } from "herdr";
import { load, tick, start, state, busy, where, setPaused, check, save, remove, lastRound } from "./engine.js";
import { describe, next } from "./schedule.js";
import { say, LANGUAGES } from "./i18n.js";

const TICK = 30_000;
const REPEATS = [["daily", "Daily"], ["weekdays", "Weekdays"], ["days", "Days"], ["every", "Every"]];
const PLACES = [["background", "Background"], ["space", "Space"], ["worktree", "Worktree"]];
const DAYS = [[1, "Mo"], [2, "Tu"], [3, "We"], [4, "Th"], [5, "Fr"], [6, "Sa"], [0, "Su"]];
const pad2 = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
// The text in the panel's language (shared "scheduler.lang", English when unset). English is the key.
const L = (key, ...args) => say(shared("scheduler.lang"), key, ...args);

// The time left until `ms` as a timer: "4:07", "20:41:12".
function timer(ms) {
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000)), h = Math.floor(s / 3600), rest = `${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
  return h ? `${h}:${rest}` : rest.replace(/^0/, "");
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60_000);
  if (m < 1) return L("just now");
  if (m < 60) return L("{0}m ago", m);
  if (m < 1440) return L("{0}h ago", Math.floor(m / 60));
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`;
}

export default class Scheduler extends View {
  init(_props, cx) {
    this.bots = null; // from jobs/, null while loading
    this.open = null; // the bot whose detail is shown
    this.output = null; // { id, text }: an ended run's screen, read back
    this.form = null; // the new or edit form's fields, while it is shown
    this.settings = false; // the settings page is shown
    cx.spawn(async (cx) => { this.bots = await load(); cx.notify(); });
    // The first tick is a full TICK after a load: saving a file reloads the mod, and that shouldn't fire runs.
    cx.timer.every(TICK, (cx) => {
      if (!this.bots) return;
      for (const [bot, trigger] of tick(this.bots)) this.go(bot, trigger, cx);
    });
    // The timers count seconds. Not in the headless copy, which draws nothing.
    if (!props()?.headless) cx.timer.every(1000, (cx) => cx.notify());
  }

  // Starts a bot and redraws when it is through: a code bot's round may change nothing but its "checked" line.
  go(bot, trigger, cx) { cx.spawn(async (cx) => { await start(bot, trigger); cx.notify(); }); }

  // A code bot's last round, or null before its first: when ("2m ago") and what it found ("3 items, 0 new").
  checked(b) {
    const c = lastRound(b.name);
    return c && [ago(c.at), c.error ? L("failed") : L(c.items === 1 ? "{0} item, {1} new" : "{0} items, {1} new", c.items, c.fresh)];
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
      this.output = { id: row.id, text: text || L("This run's terminal is gone.") };
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
      every: input(s.every ?? "30m", "30m"), catchUp: input(r.catchUp, L("none, or 2h")), cwd: input(w.cwd, "~"),
      about: input(r.about, L("optional: what this schedule is for")),
      repo: input(w.worktree?.repo, "~/code/my-repo"), ref: input(w.worktree?.commit ?? w.worktree?.branch, "origin/main"),
      agent: input((r.agent ?? []).join(" "), "claude --model haiku"),
      prompt: TextareaState.new({ placeholder: L("What the agent is told on every run"), value: r.prompt ?? "" }),
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
    if (!f.name.value().trim()) return L("name is missing");
    if (f.place === "space" && !f.space) return L("pick a space");
    if (f.place === "worktree" && !bot.where.worktree[f.rev]) return L("{0} is missing", f.rev);
    try { check(bot); } catch (e) { return L(String(e.message ?? e)); }
    return f.problem && L(f.problem);
  }

  render() {
    // A copy that only runs the bots, for a layout whose panel isn't always shown (a mod starts the
    // first time it shows): put it in a floating block, which draws nothing when empty.
    if (props()?.headless) return div();
    const t = theme();
    if (this.settings) return this.card(t, L("Settings"), this.renderSettings(t), (cx) => { this.settings = false; cx.notify(); });
    if (this.form) return this.card(t, this.form.original ? L("Edit {0}", this.form.original) : L("New schedule"), this.renderForm(t), (cx) => { this.form = null; cx.notify(); });
    const bot = this.open && this.bots?.find((b) => b.name === this.open);
    return this.card(t, bot ? bot.name : L("Scheduler"), bot ? this.detail(bot, t) : this.list(t),
      bot && ((cx) => { this.open = null; this.output = null; cx.notify(); }));
  }

  renderSettings(t) {
    const lang = shared("scheduler.lang") ?? "en";
    return v_flex().p(14).gap(6)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(L("Language")))
      .child(this.pills("s-lang", LANGUAGES, lang, t, (v) => setShared("scheduler.lang", v)));
  }

  // The panel: a header with a title (a back button when `back`), a scrolling body, and on the list
  // (no `back`) a footer with Settings and Add schedule, drawn like the rows at the foot of Herdr's sidebar.
  card(t, title, body, back) {
    return v_flex().id("scheduler").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(back), (el) => el.child(this.button("back", "‹", t, back)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
        .when(!back && Boolean(this.bots), (el) => el
          .child(div().text_size(11).text_color(t.dim).child(L(this.bots.length === 1 ? "{0} schedule" : "{0} schedules", this.bots.length)))))
      .child(div().id("scheduler-body").flex_1().min_h(0).overflow_y_scrollbar().child(body))
      .when(!back, (el) => {
        const row = (id, icon, label, color, onClick) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
          .text_color(color).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
          .on_click((_e, cx) => onClick(cx)).child(svg(`mods/herdr-scheduler/${icon}.svg`).size(14)).child(L(label));
        return el.child(v_flex().flex_none().px(8).pt(4).pb(8).border_t(1).border_color(t.border)
          .child(row("scheduler-settings", "settings", "Settings", t.muted, (cx) => { this.settings = true; cx.notify(); }))
          .child(row("scheduler-add", "plus", "Add schedule", t.dim, (cx) => this.edit(null, cx))));
      });
  }

  pills(id, options, value, t, pick) {
    return h_flex().flex_wrap().gap(5).children(options.map(([v, label]) => {
      const on = Array.isArray(value) ? value.includes(v) : v === value;
      return h_flex().id(`${id}-${v}`).h(24).px(8).items_center().rounded(6).text_size(12).cursor_pointer()
        .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted)
        .border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { pick(v); if (this.form) this.form.problem = null; cx.notify(); }).child(label);
    }));
  }

  renderForm(t) {
    const f = this.form, problem = this.problem();
    const label = (text) => div().pt(6).text_size(11).font_semibold().text_color(t.dim).child(L(text));
    const named = (options) => options.map(([v, text]) => [v, L(text)]);
    const input = (id, state) => div().id(id).h(30).px(9).flex().items_center().rounded(7).border_1().border_color(t.input).bg(t.surface)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(state).h_full().w_full().text_size(12));
    const folder = (id, state, prompt) => h_flex().gap(6).child(div().flex_1().child(input(id, state)))
      .child(this.button(`${id}-pick`, L("Choose…"), t, (cx) => cx.spawn(async (cx) => {
        const dir = await pickFolder({ prompt });
        if (dir) state.set_value(dir);
        cx.notify();
      })));
    return v_flex().p(14).gap(4)
      .when(!f.original, (el) => el.child(label("Name")).child(input("f-name", f.name)))
      .child(label("About")).child(input("f-about", f.about))
      .child(label("Repeat")).child(this.pills("f-repeat", named(REPEATS), f.repeat, t, (v) => { f.repeat = v; }))
      .when(f.repeat === "days", (el) => el.child(this.pills("f-day", named(DAYS), f.days, t,
        (d) => { f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d]; })))
      .when(f.repeat === "every", (el) => el.child(label("Interval (5m, 2h, 1d)")).child(div().w(100).child(input("f-every", f.every))))
      .when(f.repeat !== "every", (el) => el.child(label("Time (24h)")).child(div().w(100).child(input("f-time", f.time)))
        .child(label("Catch up a missed run within")).child(div().w(100).child(input("f-catchup", f.catchUp))))
      .child(label("Where")).child(this.pills("f-place", named(PLACES), f.place, t, (v) => { f.place = v; }))
      .when(f.place === "background", (el) => el.child(label("Folder")).child(folder("f-cwd", f.cwd, L("Run here"))))
      .when(f.place === "space", (el) => el.child(this.pills("f-space", spaces().filter((s) => !s.machine).map((s) => [s.name, s.name]), f.space, t, (v) => { f.space = v; })))
      .when(f.place === "worktree", (el) => el.child(label("Repository")).child(folder("f-repo", f.repo, L("This repository")))
        .child(label("Check out")).child(h_flex().gap(6).items_center()
          .child(this.pills("f-rev", named([["commit", "Commit"], ["branch", "Branch"]]), f.rev, t, (v) => { f.rev = v; }))
          .child(div().flex_1().child(input("f-ref", f.ref)))))
      .child(label("Agent command")).child(input("f-agent", f.agent))
      .child(label("Prompt")).child(div().id("f-prompt").p(8).rounded(7).border_1().border_color(t.input)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(f.prompt).w_full().text_size(12)))
      .child(div().pt(8).min_h(26).text_size(12).text_color(t.ansi1).child(problem ?? ""))
      .child(h_flex().gap(8).justify_end()
        .child(this.button("f-cancel", L("Cancel"), t, (cx) => { this.form = null; cx.notify(); }))
        .child(this.button("f-save", L("Save"), t, (cx) => {
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

  // One line of 30 hour-wide cells: the last six hours, now, the next twenty-four (so a daily schedule
  // is always on it). Left of now,
  // how runs went (green, or red when one failed); right of it, when schedules run: the next one
  // filled, the later ones hollow. Back from a break, one look says what happened and what is coming.
  // A schedule that runs more than hourly would fill the line, so its coming runs are left to its timer.
  timeline(t) {
    const now = Date.now(), HOUR = 3_600_000, NOW = 6, start = Math.floor(now / HOUR) * HOUR - NOW * HOUR;
    const cells = Array.from({ length: 30 }, () => ({ ran: [], runs: [] })), paused = shared("scheduler.paused") ?? {};
    const names = new Set(this.bots.map((b) => b.name));
    for (const r of shared("scheduler.history") ?? []) if (r.at >= start && r.at <= now && names.has(r.bot)) cells[Math.floor((r.at - start) / HOUR)].ran.push(r);
    for (const b of this.bots) {
      if (b.error || paused[b.name] || b.schedule.every < HOUR) continue;
      for (let at = next(b.schedule, now); at < start + 30 * HOUR; at = next(b.schedule, at)) cells[Math.floor((at - start) / HOUR)].runs.push([b, at]);
    }
    const first = cells.findIndex((c) => c.runs.length), soonest = cells[first]?.runs[0];
    const bad = (r) => ["failed", "missed", "interrupted"].includes(state(r));
    const open = (name) => (_e, cx) => { this.open = name; this.output = null; cx.notify(); };
    const line = (i) => div().flex_1().h(1).bg(i < NOW ? t.border : t.input);
    return v_flex().px(14).pt(12).pb(10).gap(5).border_b(1).border_color(t.border)
      .child(h_flex().gap(6).text_size(10.5).text_color(t.dim)
        .child(div().font_semibold().child(L("Timeline")))
        .child(div().flex_1())
        // What the filled dot is: the next run on the line.
        .when(Boolean(soonest), (el) => el.child(div().min_w(0).truncate().text_color(t.foreground).child(`${hm(new Date(soonest[1]))} ${soonest[0].name}${cells[first].runs.length > 1 ? ` +${cells[first].runs.length - 1}` : ""}`))))
      .child(h_flex().h(14).items_center().children(cells.map(({ ran, runs }, i) => h_flex().flex_1().min_w(0).h_full().items_center()
        // A tick every six hours, where the labels below stand; a taller bar is now.
        .when(i > 0 && i % 6 === 0 && i !== NOW, (el) => el.child(div().w(1).h(5).flex_none().bg(t.dim)))
        .child(line(i < NOW ? i : -1))
        .when(ran.length > 0, (el) => el.child(div().id(`tl-ran-${i}`).size(6).flex_none().rounded_full().cursor_pointer()
          .bg(ran.some(bad) ? t.ansi1 : t.ansi2)
          .tooltip(ran.map((r) => `${hm(new Date(r.at))} ${r.bot} ${L(state(r))}`).join(", "))
          .on_click(open(ran[0].bot))).child(line(-1)))
        .when(i === NOW, (el) => el.child(div().w(2).h(14).flex_none().rounded(1).bg(t.foreground)).child(line(i)))
        .when(runs.length > 0, (el) => el.child(div().id(`tl-${i}`).size(8).flex_none().rounded_full().cursor_pointer()
          .border_1().border_color(t.accent).bg(i === first ? t.accent : t.background)
          .tooltip(runs.map(([b, at]) => `${hm(new Date(at))} ${b.name}`).join(", "))
          .on_click(open(runs[0][0].name))).child(line(i))))))
      .child(h_flex().text_size(10).text_color(t.dim).children([0, 6, 12, 18, 24].map((i) =>
        div().flex_1().min_w(0).child(i === NOW ? L("now") : hm(new Date(start + i * HOUR))))));
  }

  // The list, by what needs a look first: running, then gone wrong, then what is coming (soonest
  // first), then paused. A section is named only when there is more than one.
  list(t) {
    if (!this.bots) return div().p(14).text_color(t.dim).child(L("Loading…"));
    if (!this.bots.length) return v_flex().p(14).gap(6).text_size(12).text_color(t.muted)
      .child(div().text_color(t.foreground).child(L("No schedules yet.")))
      .child(L("A schedule is one JS file. Press Add schedule to make one, or copy one from mods/herdr-scheduler/examples/ to mods/herdr-scheduler/jobs/ and edit it; it shows up here when saved."));
    const now = Date.now(), groups = { Running: [], "Needs attention": [], Upcoming: [], Paused: [] };
    for (const b of this.bots) {
      const [word] = this.status(b, t);
      groups[word === "running" || word === "blocked" ? "Running" : word === "paused" ? "Paused" : word ? "Needs attention" : "Upcoming"].push(b);
    }
    groups.Upcoming.sort((a, b) => next(a.schedule, now) - next(b.schedule, now));
    const shown = Object.entries(groups).filter(([, bots]) => bots.length);
    return v_flex().pb(8).child(this.timeline(t)).children(shown.flatMap(([name, bots]) => [
      ...(shown.length > 1 ? [h_flex().px(16).pt(12).pb(2).gap(6).text_size(10.5).font_semibold().text_color(t.dim)
        .child(L(name)).child(div().font_normal().child(String(bots.length)))] : [div().h(6)]),
      ...bots.map((b) => this.row(b, t)),
    ]));
  }

  // One schedule: its name over when and where it runs, and on the right the timer to its next run (or
  // its state's word) over how the last run went. Only a schedule in a state stands out, with a raised
  // background and a bar in the state's color: the idle ones stay plain.
  row(b, t) {
    const [word, color] = this.status(b, t), last = this.history(b.name)[0], s = last && state(last), round = b.code && this.checked(b);
    const at = !b.error && next(b.schedule, Date.now());
    const wrong = b.error ?? ((s === "failed" || s === "skipped") && last.note);
    const meta = wrong ? L(wrong) : [L(describe(b.schedule)), L(b.code ? "code" : where(b.where))].join(" · ");
    const went = s === "done" || s === "handled" ? t.ansi2 : s === "failed" || s === "missed" || s === "interrupted" ? t.ansi1 : null;
    return h_flex().id(`bot-${b.name}`).mx(8).pl(10).pr(8).py(7).gap(10).items_center().rounded(8).cursor_pointer()
      .border_l(2).border_color(word ? color : t.background).when(Boolean(word), (el) => el.bg(t.raised)).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { this.open = b.name; this.output = null; cx.notify(); })
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().font_medium().child(b.name))
        .child(div().truncate().text_size(11).text_color(wrong ? t.ansi1 : t.muted).child(meta)))
      .when(!b.error, (el) => el
        .child(v_flex().flex_none().gap(2).items_end()
          // Mono digits: the timer doesn't jiggle as it counts. Bright in its last hour.
          .child(word ? div().text_size(11).text_color(color).child(L(word))
            : div().font_family(settings().font_family ?? "JetBrains Mono").text_size(12).text_color(at - Date.now() < 3_600_000 ? t.foreground : t.muted).child(timer(at)))
          .when(Boolean(round || last), (e) => e.child(h_flex().gap(4).items_center().text_size(10.5).text_color(t.dim)
            .when(Boolean(went) && !round, (x) => x.child(div().size(5).rounded_full().bg(went)))
            .child(round ? L("checked {0}", round[0]) : ago(last.at)))))
        .child(div().id(`run-${b.name}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_size(10)
          .text_color(t.dim).hover((st) => st.bg(t.raised).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.go(b, "manual", cx)).child("▶")));
  }

  detail(b, t) {
    // A file that is plain data can go through the form; one with functions is edited as a file.
    const plain = b.raw && typeof b.raw === "object" && !Object.values(b.raw).some((v) => typeof v === "function");
    const manage = [
      ...(plain ? [this.button("d-edit", L("Edit"), t, (cx) => this.edit(b, cx))] : []),
      this.button("d-rm", L(this.deleting === b.name ? "Really delete" : "Delete"), t, (cx) => {
        if (this.deleting !== b.name) { this.deleting = b.name; return cx.notify(); }
        cx.spawn(() => remove(b.name)); // the mod reloads without it
      }),
    ];
    if (b.error) return v_flex().p(14).gap(10).child(h_flex().gap(6).children(manage))
      .child(div().text_size(12).text_color(t.ansi1).child(L(b.error)));
    const paused = Boolean((shared("scheduler.paused") ?? {})[b.name]), rows = this.history(b.name);
    const w = b.where ?? {}, place = w.background ? L("background, {0}", w.cwd ?? "~") : w.space != null ? L("space {0}", w.space)
      : w.worktree && L("worktree {0} of {1}", w.worktree.name ?? b.name, w.worktree.repo);
    const kv = (k, v) => h_flex().gap(8).text_size(12).child(div().w(64).flex_none().text_color(t.dim).child(L(k))).child(div().flex_1().min_w(0).truncate().child(v));
    const round = b.code && this.checked(b);
    const tone = { running: t.working, blocked: t.blocked, done: t.ansi2, handled: t.ansi2, failed: t.ansi1, missed: t.ansi1, interrupted: t.ansi1 };
    return v_flex().p(14).gap(10)
      .child(h_flex().gap(6)
        .child(this.button("d-run", L("Run now"), t, (cx) => this.go(b, "manual", cx), true))
        .child(this.button("d-pause", L(paused ? "Resume" : "Pause"), t, () => setPaused(b.name, !paused)))
        .children(manage))
      .when(Boolean(b.about), (el) => el.child(div().text_size(12).text_color(t.muted).child(b.about)))
      .child(v_flex().gap(4)
        .child(kv("Schedule", b.catchUp ? L("{0}, catches up within {1}m", L(describe(b.schedule)), b.catchUp / 60_000) : L(describe(b.schedule))))
        .child(kv("Next", paused ? L("paused") : timer(next(b.schedule, Date.now()))))
        .when(!b.code, (el) => el.child(kv("Where", place)).child(kv("Agent", b.agent.join(" "))))
        .when(b.code, (el) => el.child(kv("Runs", L(b.raw.ended ? "code: poll, handle, ended" : "code: poll, handle")))
          .child(kv("Checked", round ? round.join(": ") : L("not since the last reload")))))
      .when(!b.code, (el) => el.child(div().p(8).rounded(7).bg(t.raised).text_size(12).text_color(t.muted).child(b.prompt)))
      .child(div().pt(4).text_size(11).font_semibold().text_color(t.dim).child(L("History")))
      .children(rows.length ? rows.flatMap((r) => {
        const s = state(r);
        return [h_flex().id(`h-${r.id}`).gap(8).px(6).py(4).rounded(6).items_center().cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => this.show(r, cx))
          .child(div().w(70).flex_none().text_size(11).text_color(tone[s] ?? t.muted).child(L(s)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child([r.item, r.note && L(r.note)].filter(Boolean).join(": ") || L(r.trigger)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(r.at))),
        ...(this.output?.id === r.id ? [div().p(8).rounded(7).bg(t.raised).text_size(11).text_color(t.muted)
          .font_family(settings().font_family ?? "JetBrains Mono").child(this.output.text)] : [])];
      }) : [div().text_size(12).text_color(t.dim).child(L("No runs yet."))]);
  }
}
