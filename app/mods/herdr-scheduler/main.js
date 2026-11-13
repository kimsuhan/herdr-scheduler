// Scheduler: bots that give an agent a prompt on a schedule, or run code that polls for items. A bot
// is a file in this mod's jobs/ folder (see examples/). This panel lists them, runs or pauses one, and
// shows each one's history.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { hc, run, theme, settings, shared, setShared, spaces, terminals, pickFolder, props, appHome, home, knownAgents } from "herdr";
import { load, tick, start, state, busy, running, setPaused, check, save, remove, roundsOf, historyDays, historyDay, current, setOverride, tidy } from "./engine.js";
import { describe, next, parse, keepDays, fold } from "./schedule.js";
import { say, LANGUAGES } from "./i18n.js";
import { scriptPrompt, editPrompt } from "./prompt.js";

const TICK = 5_000;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SETTLE = 30_000; // no runs this soon after a load: a run of saves reloads the mod each time
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
    this.loaded = null; // from jobs/, null while loading
    this.open = null; // the bot whose detail is shown
    this.output = null; // { id, text }: an ended run's screen, read back
    this.form = null; // the new or edit form's fields, while it is shown
    this.settings = false; // the settings page is shown
    this.past = null; // the All history page, while shown: { name, days (newest first, null while read), i, rows }
    this.guide = null; // the Add script page, while shown: { agents (installed, null while asked), agent, copied, shown (the prompt) }
    cx.spawn(async (cx) => { this.loaded = await load(); cx.notify(); });
    const loadedAt = Date.now();
    cx.timer.every(TICK, (cx) => {
      if (!this.bots || Date.now() - loadedAt < SETTLE) return;
      for (const [bot, trigger] of tick(this.bots)) this.go(bot, trigger, cx);
      if (this.tidying) return; // the last tidy's hc calls can outlast a tick
      this.tidying = true;
      const bots = this.bots;
      cx.spawn(async (cx) => { try { await tidy(bots); } finally { this.tidying = false; } cx.notify(); });
    });
    // The timers count seconds. Not in the headless copy, which draws nothing.
    if (!props()?.headless) cx.timer.every(1000, (cx) => cx.notify());
  }

  // The schedules as they run now: the files, with what the panel changed of the scripts laid over.
  get bots() { return this.loaded && current(this.loaded); }

  // Starts a bot and redraws when it is through: a code bot's round may change nothing but its "checked" line.
  go(bot, trigger, cx) { cx.spawn(async (cx) => { await start(bot, trigger); cx.notify(); }); }

  // A code bot's last round, or null before its first: when ("2m ago") and what it found ("3 items, 0 new").
  checked(b) {
    const c = roundsOf(b.name)[0];
    return c && [ago(c.at), this.found(c)];
  }

  // What a round found, or "failed".
  found(c) { return c.status === "failed" ? L("failed") : L(c.items === 1 ? "{0} item, {1} new" : "{0} items, {1} new", c.items, c.fresh); }

  history(name) { return (shared("scheduler.history") ?? []).filter((r) => r.bot === name); }

  // A bot's runs and, for a script, its rounds, newest first. `failedOnly`: only the rounds that failed
  // (for the strips and the timeline, where a round that went well would make every bar alike).
  runs(name, failedOnly) {
    const own = roundsOf(name).filter((r) => !failedOnly || r.status === "failed").map((r) => ({ ...r, bot: name }));
    return [...this.history(name), ...own].sort((a, b) => b.at - a.at);
  }

  // The last `n` runs as a strip of bars, oldest at the left: green went well, red went wrong, the
  // state's color while one is going. Slots with no run yet are small dots, so the strip keeps its width.
  strip(rows, n, t) {
    const tone = { running: t.working, starting: t.working, blocked: t.blocked, done: t.ansi2, handled: t.ansi2, failed: t.ansi1, missed: t.ansi1, interrupted: t.ansi1 };
    const runs = rows.slice(0, n).reverse();
    return h_flex().gap(2).items_end().flex_none()
      .children(Array.from({ length: n - runs.length }, () => div().w(3).h(3).rounded_full().bg(t.border)))
      .children(runs.map((r) => div().w(3).h(10).rounded(1.5).bg(tone[state(r)] ?? t.dim)));
  }

  // A run's terminal if it is still there: a background one is peeked at, a pane is gone to.
  // An ended one's last screen is read back into the panel.
  show(row, cx) {
    if (!row.terminal) return;
    // Still there (a background agent is ended once its turn is over; its row stays "done").
    if (terminals().some((k) => k.address === row.terminal && k.state === "live" && k.labels?.["scheduler.run"] === row.id))
      return run(row.where === "background" ? "terminal.peek" : "pane.focus", { terminal: row.terminal });
    if (this.output?.id === row.id) { this.output = null; return cx.notify(); }
    cx.spawn(async (cx) => {
      const r = row.removed ? { code: 1 } : await hc(["read", row.terminal, "--lines", "200"]);
      const text = r.code === 0 ? r.stdout.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim() : "";
      this.output = { id: row.id, text: text || L("This run's terminal is gone.") };
      cx.notify();
    });
  }

  // The form, for a new schedule or one whose file is plain data (no functions, so it can be written
  // back). A script (a file with functions) gets a short form: its schedule and about line only, kept
  // as an override beside the file.
  edit(bot, cx) {
    const over = bot?.code && (shared("scheduler.overrides") ?? {})[bot.name];
    const r = over ?? bot?.raw ?? { schedule: { weekdays: "09:00" }, where: { background: true }, agent: ["claude"], prompt: "" };
    const s = r.schedule ?? {}, w = r.where ?? {};
    const input = (value, placeholder) => {
      const state = InputState.new({ placeholder, value: value ?? "" });
      state.on("change", (_e, cx) => cx.notify()); // the problem line follows what is typed
      return state;
    };
    this.form = {
      original: bot?.name ?? null, problem: null, code: Boolean(bot?.code), over: Boolean(over),
      ask: bot?.code ? this.asking(cx) : null, // its code is changed by an agent, not in the form
      repeat: s.every != null ? "every" : s.daily != null ? "daily" : s.days ? "days" : "weekdays", days: s.days ?? [1],
      place: w.space != null ? "space" : w.worktree ? "worktree" : "background", space: w.space ?? "",
      rev: w.worktree?.branch != null ? "branch" : "commit", folder: w.worktree?.name,
      name: input(bot?.name, "dependency-check"), time: input(s.daily ?? s.weekdays ?? s.at ?? "09:00", "09:00"),
      every: input(s.every ?? "30m", "30m"), catchUp: input(r.catchUp, L("none, or 2h")), cwd: input(w.cwd, "~"),
      about: input(r.about, L("optional: what this schedule is for")), keep: input(r.keepHistory, "30d"),
      repo: input(w.worktree?.repo, "~/code/my-repo"), ref: input(w.worktree?.commit ?? w.worktree?.branch, "origin/main"),
      agent: input((r.agent ?? []).join(" "), "claude --model haiku"),
      prompt: TextareaState.new({ placeholder: L("What the agent is told on every run"), value: r.prompt ?? "" }),
    };
    this.form.prompt.set_auto_grow(4, 12);
    this.form.prompt.on("change", (_e, cx) => cx.notify());
    cx.notify();
    // The agents to offer: the ones Herdr can start that are installed here. Once they are known the
    // command is read back as one of them with an optional model; anything else is a command of the
    // person's own (`custom`), shown as text to edit.
    const f = this.form;
    f.custom = true;
    f.model = InputState.new({ placeholder: L("default model"), value: "" });
    f.model.on("change", (_e, cx) => { this.compose(); cx.notify(); });
    if (!f.code) cx.spawn(async (cx) => {
      try { f.agents = (await knownAgents()).filter((a) => a.installed); } catch { f.agents = []; }
      const argv = f.agent.value().trim().split(/\s+/).filter(Boolean);
      const a = f.agents.find((a) => a.run.every((x, i) => argv[i] === x)), rest = a && argv.slice(a.run.length);
      if (a && (rest.length === 0 || (rest.length === 2 && rest[0] === "--model"))) {
        f.pick = a.key; f.custom = false;
        if (rest[1]) f.model.set_value(rest[1]);
      }
      cx.notify();
    });
  }

  // The picked agent's command with the model, written into the command field (which is what is saved).
  compose() {
    const f = this.form, a = !f.custom && f.agents?.find((a) => a.key === f.pick), model = f.model.value().trim();
    if (a) f.agent.set_value([...a.run, ...(model ? ["--model", model] : [])].join(" "));
  }

  // The form as a bot file's default export.
  entry() {
    const f = this.form, v = (state) => state.value().trim(), time = v(f.time);
    const schedule = f.repeat === "every" ? { every: v(f.every) } : f.repeat === "days" ? { days: [...f.days].sort(), at: time } : { [f.repeat]: time };
    const keep = v(f.keep) ? { keepHistory: v(f.keep) } : {};
    if (f.code) return { about: v(f.about), schedule, ...keep };
    return {
      ...(v(f.about) ? { about: v(f.about) } : {}),
      schedule,
      ...(v(f.catchUp) ? { catchUp: v(f.catchUp) } : {}),
      ...keep,
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
    if (f.code) { try { parse(bot.schedule); if (bot.keepHistory) keepDays(bot.keepHistory); return null; } catch (e) { return L(String(e.message ?? e)); } }
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
    if (this.guide) return this.card(t, L("Add script"), this.renderGuide(t), (cx) => { this.guide = null; cx.notify(); });
    if (this.settings) return this.card(t, L("Settings"), this.renderSettings(t), (cx) => { this.settings = false; cx.notify(); });
    if (this.form) return this.card(t, this.form.original ? L("Edit {0}", this.form.original) : L("New schedule"), this.renderForm(t), (cx) => { this.form = null; cx.notify(); });
    if (this.past) return this.card(t, L("History of {0}", this.past.name), this.renderPast(t), (cx) => { this.past = null; this.output = null; cx.notify(); });
    const bot = this.open && this.bots?.find((b) => b.name === this.open);
    return this.card(t, bot ? bot.name : L("Scheduler"), bot ? this.detail(bot, t) : this.list(t),
      bot && ((cx) => { this.open = null; this.output = null; cx.notify(); }));
  }

  // The Add script page. A script is code, so there is no form for it: the page says how one is made
  // and hands an agent a prompt that makes it ask what to build.
  addScript(cx) {
    this.guide = this.asking(cx);
    cx.notify();
  }

  // The state of an "ask an agent" card: the installed agents (null while asked), the picked one,
  // whether the prompt was copied and whether it is unfolded.
  asking(cx) {
    const g = { agents: null, agent: null, copied: false, shown: false };
    cx.spawn(async (cx) => {
      try { g.agents = (await knownAgents()).filter((a) => a.installed); } catch { g.agents = []; }
      g.agent = g.agents[0]?.key ?? null;
      cx.notify();
    });
    return g;
  }

  // A card that hands an agent a prompt: pick an installed agent and start it in a new tab (in Herdr's
  // folder, where it finds the mod and Herdr's own guide for writing one), copy the prompt, or read it.
  askCard(t, g, id, text, { title, note, tab, done }) {
    const mono = settings().font_family ?? "JetBrains Mono", agent = g.agents?.find((a) => a.key === g.agent);
    const quiet = (key, label, onClick) => div().id(`${id}-${key}`).px(8).py(4).rounded(6).text_size(11.5).text_color(t.muted).cursor_pointer()
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(L(label));
    return v_flex().p(12).gap(10).rounded(10).bg(t.raised)
      .child(v_flex().gap(3)
        .child(div().text_size(13).font_medium().child(L(title)))
        .child(div().text_size(11.5).text_color(t.muted).child(L(note))))
      .when(Boolean(g.agents?.length), (el) => el
        .child(h_flex().flex_wrap().gap(6).children(g.agents.map((a) => {
          const on = a.key === g.agent;
          return h_flex().id(`${id}-agent-${a.key}`).h(28).px(9).gap(6).items_center().rounded(7).text_size(12).cursor_pointer()
            .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
            .border_1().border_color(on ? t.accent : t.border).hover((st) => st.bg(t.hover))
            .on_click((_e, cx) => { g.agent = a.key; cx.notify(); })
            .when(Boolean(a.icon), (e) => e.child(a.tint ? svg(a.icon).size(14) : image(a.icon).w(14).h(14)))
            .child(a.name);
        })))
        .child(h_flex().id(`${id}-send`).h(32).items_center().justify_center().rounded(8).text_size(12.5).font_medium().cursor_pointer()
          .bg(t.solid).text_color(t.solid_foreground).hover((st) => st.opacity(0.88))
          .on_click((_e, cx) => { run("tab.new", { name: tab, folder: appHome(), argv: agent.run, task: text }); done(); cx.notify(); })
          .child(L("Start in a new tab"))))
      .child(h_flex().gap(2)
        .child(quiet("copy", g.copied ? "Copied" : "Copy prompt", (cx) => { cx.write_to_clipboard(text); g.copied = true; }))
        .child(quiet("show", g.shown ? "Hide prompt" : "Show prompt", () => { g.shown = !g.shown; })))
      .when(Boolean(g.shown), (el) => el.child(div().id(`${id}-prompt`).h(220).p(8).rounded(7).bg(t.background).overflow_y_scrollbar()
        .font_family(mono).text_size(11).text_color(t.muted).child(text)));
  }

  renderGuide(t) {
    const g = this.guide, dir = `${appHome()}/mods/herdr-scheduler`.replace(home(), "~");
    const text = scriptPrompt(dir, shared("scheduler.lang") === "ko" ? "Korean" : "English");
    const mono = settings().font_family ?? "JetBrains Mono";
    const title = (s) => div().text_size(13).font_medium().child(L(s));
    const note = (s) => div().text_size(11.5).text_color(t.muted).child(L(s));
    // What a script does, as three steps in a row.
    const step = (n, head, sub) => v_flex().flex_1().min_w(0).p(8).gap(3).rounded(8).border_1().border_color(t.border)
      .child(h_flex().gap(6).items_center()
        .child(div().size(16).flex_none().flex().items_center().justify_center().rounded_full().bg(t.raised).text_size(10).text_color(t.muted).child(String(n)))
        .child(div().truncate().text_size(12).font_medium().child(L(head))))
      .child(div().text_size(10.5).text_color(t.muted).child(L(sub)));
    return v_flex().p(14).gap(12)
      .child(div().text_size(13).child(L("A script checks something on a schedule and reacts only to what is new.")))
      .child(h_flex().gap(6)
        .child(step(1, "Check", "on its schedule"))
        .child(step(2, "New only", "each item once"))
        .child(step(3, "React", "an agent, or a note")))
      // The main way: an agent writes it, after asking what to build.
      .child(this.askCard(t, g, "guide", text, { title: "Have an agent write it", tab: L("New script"), done: () => { this.guide = null; },
        note: "The prompt explains how scripts work and makes the agent ask you what to build." }))
      // The other way: the example file, by hand.
      .child(v_flex().p(12).gap(8).rounded(10).border_1().border_color(t.border)
        .child(v_flex().gap(3)
          .child(title("Write it by hand"))
          .child(note("Copy the example into the jobs folder and edit it. Its comments explain the format, and saving the file adds it here.")))
        .child(v_flex().gap(3).font_family(mono).text_size(11).text_color(t.muted)
          .child(div().truncate().child(`${dir}/examples/worktree-cleanup.js`))
          .child(div().truncate().child(`→ ${dir}/jobs/<name>.js`))));
  }

  renderSettings(t) {
    const lang = shared("scheduler.lang") ?? "en";
    return v_flex().p(14).gap(6)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(L("Language")))
      .child(this.pills("s-lang", LANGUAGES, lang, t, (v) => setShared("scheduler.lang", v)));
  }

  // The panel: a header with a title (a back button when `back`), a scrolling body, and on the list
  // (no `back`) a footer with Settings, Add schedule and Add script, drawn like the rows at the foot of Herdr's sidebar.
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
          .child(row("scheduler-add", "plus", "Add schedule", t.dim, (cx) => this.edit(null, cx)))
          .child(row("scheduler-add-script", "script", "Add script", t.dim, (cx) => this.addScript(cx))));
      });
  }

  pills(id, options, value, t, pick, rest = t.raised) {
    return h_flex().flex_wrap().gap(5).children(options.map(([v, label]) => {
      const on = Array.isArray(value) ? value.includes(v) : v === value;
      return h_flex().id(`${id}-${v}`).h(24).px(8).items_center().rounded(6).text_size(12).cursor_pointer()
        .bg(on ? t.selected : rest).text_color(on ? t.foreground : t.muted)
        .border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { pick(v); if (this.form) this.form.problem = null; cx.notify(); }).child(label);
    }));
  }

  // The form as three cards, in the order one thinks of a schedule: what the agent is told, when, and
  // who runs it where. A script's short form has only what the panel may change of it.
  renderForm(t) {
    const f = this.form, problem = this.problem(), bg = t.background;
    const label = (text) => div().text_size(11).font_semibold().text_color(t.dim).child(L(text));
    const named = (options) => options.map(([v, text]) => [v, L(text)]);
    const input = (id, state) => div().id(id).h(30).px(9).flex().items_center().rounded(7).border_1().border_color(t.input).bg(bg)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(state).h_full().w_full().text_size(12));
    const field = (text, control) => v_flex().gap(4).child(label(text)).child(control);
    const hint = (text) => div().text_size(11).text_color(t.muted).child(L(text));
    const folder = (id, state, prompt) => h_flex().gap(6).child(div().flex_1().child(input(id, state)))
      .child(this.button(`${id}-pick`, L("Choose…"), t, (cx) => cx.spawn(async (cx) => {
        const dir = await pickFolder({ prompt });
        if (dir) state.set_value(dir);
        cx.notify();
      })));
    const card = (n, title) => v_flex().p(12).gap(10).rounded(10).bg(t.raised)
      .child(h_flex().gap(7).items_center()
        .child(div().size(16).flex_none().flex().items_center().justify_center().rounded_full().bg(bg).text_size(10).text_color(t.muted).child(String(n)))
        .child(div().text_size(13).font_medium().child(L(title))));
    // What the schedule comes to, as it is typed: "weekdays 09:00 · next run in 19:58:12".
    let comes = null;
    try { const p = parse(this.entry().schedule); comes = `${L(describe(p))} · ${L("next run in {0}", timer(next(p, Date.now())))}`; } catch {}
    return v_flex().p(14).gap(10)
      .when(!f.code, (el) => el.child(card(1, "What")
        .child(field("Name", input("f-name", f.name)))
        .child(field("Prompt", div().id("f-prompt").p(8).rounded(7).border_1().border_color(t.input).bg(bg)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(f.prompt).w_full().text_size(12))))
        .child(field("About", input("f-about", f.about)))))
      .when(f.code, (el) => el.child(card(1, "What").child(field("About", input("f-about", f.about)))))
      .child(card(2, "When")
        .child(this.pills("f-repeat", named(REPEATS), f.repeat, t, (v) => { f.repeat = v; }, bg))
        .when(f.repeat === "days", (el) => el.child(this.pills("f-day", named(DAYS), f.days, t,
          (d) => { f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d]; }, bg)))
        .child(h_flex().gap(10)
          .child(div().w(104).child(f.repeat === "every" ? field("Interval (5m, 2h, 1d)", input("f-every", f.every)) : field("Time (24h)", input("f-time", f.time))))
          .when(f.repeat !== "every" && !f.code, (el) => el.child(div().flex_1().child(field("Catch up a missed run within", input("f-catchup", f.catchUp))))))
        .when(Boolean(comes), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(comes)))
        .child(div().w(104).child(field("Keep history", input("f-keep", f.keep)))))
      .when(!f.code, (el) => el.child(card(3, "Who and where")
        .child(v_flex().gap(6).child(label("Agent"))
          .when(Boolean(f.agents?.length), (e) => e.child(h_flex().flex_wrap().gap(6).children(f.agents.map((a) => {
            const on = !f.custom && a.key === f.pick;
            return h_flex().id(`f-agent-${a.key}`).h(28).px(9).gap(6).items_center().rounded(7).text_size(12).cursor_pointer()
              .bg(on ? t.selected : bg).text_color(on ? t.foreground : t.muted)
              .border_1().border_color(on ? t.accent : t.border).hover((st) => st.bg(t.hover))
              .on_click((_e, cx) => { f.pick = a.key; f.custom = false; this.compose(); cx.notify(); })
              .when(Boolean(a.icon), (x) => x.child(a.tint ? svg(a.icon).size(14) : image(a.icon).w(14).h(14)))
              .child(a.name);
          }))))
          // A picked agent: its model, and the command that comes of it as text, with a pencil to take
          // the command over. A command of the person's own: the field itself.
          .when(!f.custom, (e) => e
            .child(h_flex().gap(8).items_center().child(label("Model")).child(div().w(150).child(input("f-model", f.model))))
            .child(h_flex().gap(6).items_center()
              .child(div().flex_1().min_w(0).truncate().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted).child(f.agent.value()))
              .child(div().id("f-agent-edit").size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
                .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(L("Edit the command"))
                .on_click((_e, cx) => { f.custom = true; cx.notify(); }).child(svg("mods/herdr-scheduler/pencil.svg").size(12)))))
          .when(Boolean(f.custom), (e) => e.child(input("f-agent", f.agent))))
        .child(v_flex().gap(6).child(label("Where"))
          .child(this.pills("f-place", named(PLACES), f.place, t, (v) => { f.place = v; }, bg))
          // Each place in a sentence, then its own fields.
          .child(hint({ background: "No tab: the agent runs out of sight, and you read the run in this schedule's history.",
            space: "A new tab in the space you pick.",
            worktree: "A separate copy of the repository in its own space, so the agent never touches your working folder." }[f.place]))
          .when(f.place === "background", (e) => e.child(field("Folder", folder("f-cwd", f.cwd, L("Run here")))))
          .when(f.place === "space", (e) => e.child(this.pills("f-space", spaces().filter((s) => !s.machine).map((s) => [s.name, s.name]), f.space, t, (v) => { f.space = v; }, bg)))
          .when(f.place === "worktree", (e) => e
            .child(field("Repository", folder("f-repo", f.repo, L("This repository"))))
            .child(field("Code to start from", this.pills("f-rev", named([["commit", "Latest every run"], ["branch", "Keep a branch"]]), f.rev, t, (v) => { f.rev = v; }, bg)))
            .child(hint(f.rev === "commit" ? "Before every run it fetches and checks out what you name here, so each run starts from the newest code. Nothing is committed to it."
              : "The branch is made once from the repository's current code, then left as the agent leaves it: its commits stay for the next run."))
            .child(field(f.rev === "commit" ? "Branch or commit to check out" : "Branch name", input("f-ref", f.ref)))
            .when(Boolean(f.repo.value().trim()), (x) => x.child(div().truncate().font_family(settings().font_family ?? "JetBrains Mono").text_size(10.5).text_color(t.dim)
              .child(`~/.herdr/worktrees/${f.repo.value().trim().split("/").filter(Boolean).pop()}/${f.folder ?? f.original ?? f.name.value().trim()}`)))))))
      // A script's code isn't the form's to change: an agent does it, after asking what to change.
      .when(f.code, (el) => el.child(this.askCard(t, f.ask, "f-ask",
        editPrompt(`${appHome()}/mods/herdr-scheduler`.replace(home(), "~"), f.original, shared("scheduler.lang") === "ko" ? "Korean" : "English"),
        { title: "Change its code", tab: L("Edit {0}", f.original), done: () => { this.form = null; },
          note: "The prompt points the agent at this script's file and makes it ask you what to change." })))
      // What is wrong shows once Save was pressed: an empty form isn't an error yet.
      .when(Boolean(f.tried && problem), (el) => el.child(div().text_size(12).text_color(t.ansi1).child(problem)))
      .child(h_flex().gap(8).items_center()
        .when(f.code && f.over, (el) => el.child(this.button("f-reset", L("Reset to the file"), t, (cx) => { setOverride(f.original, null); this.form = null; cx.notify(); })))
        .child(div().flex_1())
        .child(this.button("f-cancel", L("Cancel"), t, (cx) => { this.form = null; cx.notify(); }))
        .child(h_flex().id("f-save").h(28).px(16).items_center().justify_center().rounded(7).text_size(12).font_medium().cursor_pointer()
          .bg(t.solid).text_color(t.solid_foreground).hover((st) => st.opacity(0.88))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            if (problem) { f.tried = true; return cx.notify(); }
            // A script's change is an override: no file is written, so nothing reloads.
            if (f.code) { setOverride(f.original, this.entry()); this.form = null; return cx.notify(); }
            cx.spawn(async (cx) => {
              // On success the write reloads the mod, and the list comes back with the schedule in it.
              try { await save(f.name.value().trim(), this.entry(), f.original); }
              catch (e) { f.problem = String(e.message ?? e); f.tried = true; cx.notify(); }
            });
          }).child(L("Save"))));
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
    const last = this.runs(b.name)[0], s = last && state(last);
    if (busy(b.name)?.status === "blocked") return ["blocked", t.blocked];
    if (running(b.name)) return ["running", t.working];
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
    for (const r of this.bots.flatMap((b) => this.runs(b.name, true))) if (r.at >= start && r.at <= now) cells[Math.floor((r.at - start) / HOUR)].ran.push(r);
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

  // The list, by what needs a look first: running, then gone wrong, then the two kinds apart (prompt
  // schedules by when they run next, code schedules that watch for items), then paused. A section is
  // named only when there is more than one.
  list(t) {
    if (!this.bots) return div().p(14).text_color(t.dim).child(L("Loading…"));
    if (!this.bots.length) return v_flex().p(14).gap(6).text_size(12).text_color(t.muted)
      .child(div().text_color(t.foreground).child(L("No schedules yet.")))
      .child(L("A schedule is one JS file. Press Add schedule to make one, or copy one from mods/herdr-scheduler/examples/ to mods/herdr-scheduler/jobs/ and edit it; it shows up here when saved."));
    const now = Date.now(), groups = { Running: [], "Needs attention": [], Schedules: [], Scripts: [], Paused: [] };
    for (const b of this.bots) {
      const [word] = this.status(b, t);
      groups[word === "running" || word === "blocked" ? "Running" : word === "paused" ? "Paused" : word ? "Needs attention" : b.code ? "Scripts" : "Schedules"].push(b);
    }
    groups.Schedules.sort((a, b) => next(a.schedule, now) - next(b.schedule, now));
    const shown = Object.entries(groups).filter(([, bots]) => bots.length);
    return v_flex().pb(8).child(this.timeline(t)).children(shown.flatMap(([name, bots]) => [
      ...(shown.length > 1 ? [h_flex().px(16).pt(12).pb(2).gap(6).text_size(10.5).font_semibold().text_color(t.dim)
        .child(L(name)).child(div().font_normal().child(String(bots.length)))] : [div().h(6)]),
      ...bots.map((b) => this.row(b, t)),
    ]));
  }

  // One schedule: its name over when it runs, and on the right the timer to its next run (or its
  // state's word) over how its last runs went. Schedules and scripts read the same. Only a schedule in a state stands out, with a raised
  // background and a bar in the state's color: the idle ones stay plain.
  row(b, t) {
    const [word, color] = this.status(b, t), last = this.runs(b.name)[0], s = last && state(last);
    const at = !b.error && next(b.schedule, Date.now()), mono = settings().font_family ?? "JetBrains Mono";
    const wrong = b.error ?? ((s === "failed" || s === "skipped") && last.note);
    const meta = wrong ? L(wrong) : L(describe(b.schedule));
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
            : div().font_family(mono).text_size(12).text_color(at - Date.now() < 3_600_000 ? t.foreground : t.muted).child(timer(at)))
          // How its last eight runs went (all dots before its first run).
          .child(this.strip(this.runs(b.name, true), 8, t)))
        // While it runs, a spinner that can't be pressed again.
        .child(div().id(`run-${b.name}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_size(10)
          .text_color(t.dim).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .when(running(b.name), (el) => el.text_size(13).text_color(t.working).frames(SPIN, 90))
          .when(!running(b.name), (el) => el.cursor_pointer().hover((st) => st.bg(t.raised).text_color(t.foreground))
            .on_click((_e, cx) => this.go(b, "manual", cx)).child("▶"))));
  }

  // A schedule's page, as cards: when it runs next (or what it is doing) with the actions, what it
  // runs, and how its runs went.
  detail(b, t) {
    // A file that is plain data can go through the form; of a script the form changes the schedule only.
    const plain = b.raw && typeof b.raw === "object" && !Object.values(b.raw).some((v) => typeof v === "function");
    const mono = settings().font_family ?? "JetBrains Mono";
    const box = () => v_flex().p(12).gap(8).rounded(10).bg(t.raised);
    const cap = (text) => div().text_size(11).font_semibold().text_color(t.dim).child(L(text));
    const icon = (id, name, tip, onClick, color = t.muted) => h_flex().id(id).h(24).px(5).gap(5).flex_none().items_center().justify_center().rounded(6)
      .text_size(11.5).text_color(color).cursor_pointer().hover((st) => st.bg(t.hover).text_color(color === t.muted ? t.foreground : color))
      .tooltip(L(tip)).on_click((_e, cx) => onClick(cx)).child(svg(`mods/herdr-scheduler/${name}.svg`).size(13));
    // Edit and delete, as icons at the card's top right. Delete asks once: the bin turns red and says so.
    const sure = this.deleting === b.name;
    const manage = [
      ...(plain || b.code ? [icon("d-edit", "pencil", "Edit", (cx) => this.edit(b, cx))] : []),
      icon("d-rm", "trash", "Delete", (cx) => {
        if (!sure) { this.deleting = b.name; return cx.notify(); }
        cx.spawn(() => remove(b.name)); // the mod reloads without it
      }, sure ? t.ansi1 : t.muted).when(sure, (el) => el.child(L("Really delete"))),
    ];
    if (b.error) return v_flex().p(14).gap(10)
      .child(box().child(h_flex().gap(2).items_center().child(cap("Needs attention")).child(div().flex_1()).children(manage))
        .child(div().text_size(12).text_color(t.ansi1).child(L(b.error))));
    const paused = Boolean((shared("scheduler.paused") ?? {})[b.name]), [word, color] = this.status(b, t);
    const w = b.where ?? {}, place = w.background ? L("background, {0}", w.cwd ?? "~") : w.space != null ? L("space {0}", w.space)
      : w.worktree && L("worktree {0} of {1}", w.worktree.name ?? b.name, w.worktree.repo);
    const kv = (k, v) => h_flex().gap(8).text_size(12).child(div().w(64).flex_none().text_color(t.dim).child(L(k))).child(div().flex_1().min_w(0).truncate().child(v));
    const round = b.code && this.checked(b);
    return v_flex().p(14).gap(10)
      // When, large: the timer to the next run, or the state's word while it is in one.
      .child(box().gap(10)
        // On or paused, as a switch; edit and delete beside it.
        .child(h_flex().gap(2).items_center()
          .child(h_flex().id("d-pause").w(34).h(20).flex_none().p(2).rounded_full().cursor_pointer().bg(paused ? t.input : t.accent)
            .when(!paused, (el) => el.justify_end()).on_click(() => setPaused(b.name, !paused))
            .child(div().size(16).rounded_full().bg(t.background)))
          .child(div().pl(8).text_size(11.5).text_color(paused ? t.dim : t.muted).child(L(paused ? "Paused" : "On")))
          .child(div().flex_1())
          .children(manage))
        .when(Boolean(b.about), (el) => el.child(div().text_size(12).text_color(t.muted).child(b.about)))
        .child(v_flex().gap(2)
          .child(cap(word ? "Status" : "Next"))
          .child(word ? div().text_size(20).font_medium().text_color(color).child(L(word))
            : div().font_family(mono).text_size(22).child(timer(next(b.schedule, Date.now()))))
          .child(div().text_size(11.5).text_color(t.muted)
            .child(b.catchUp ? L("{0}, catches up within {1}m", L(describe(b.schedule)), b.catchUp / 60_000) : L(describe(b.schedule)))))
        .child(h_flex().id("d-run").h(32).gap(6).items_center().justify_center().rounded(8).text_size(12.5).font_medium()
          .bg(t.solid).text_color(t.solid_foreground)
          .when(running(b.name), (el) => el.opacity(0.6).child(div().frames(SPIN, 90)).child(L("Running")))
          .when(!running(b.name), (el) => el.cursor_pointer().hover((st) => st.opacity(0.88))
            .on_click((_e, cx) => this.go(b, "manual", cx)).child(L("Run now"))))
        .when(Boolean(b.changed), (el) => el.child(div().text_size(11).text_color(t.dim).child(L("Changed in the panel: the file has other values.")))))
      // What it runs.
      .child(b.code
        ? box().child(cap("Runs"))
          .child(kv("Runs", L(b.raw.ended ? "code: poll, handle, ended" : "code: poll, handle")))
          .child(kv("Checked", round ? round.join(": ") : L("not since the last reload")))
        : box().child(cap("Prompt"))
          .child(div().p(8).rounded(7).bg(t.background).text_size(12).text_color(t.muted).child(b.prompt))
          .child(kv("Agent", b.agent.join(" ")))
          .child(kv("Where", place)))
      // How its runs went: the last ones as a strip (newest at the right), then each run and round,
      // how long they are kept, and the way to the older ones.
      .child(box()
        .child(h_flex().gap(8).items_center().child(cap("History"))
          .child(div().text_size(11).text_color(t.dim).child(L("kept {0} days", b.keep)))
          .child(div().flex_1())
          .child(this.strip(this.runs(b.name, true), 16, t)))
        .children(this.entries(fold(this.runs(b.name)), t))
        .child(h_flex().id("d-past").h(26).items_center().justify_center().rounded(7).text_size(11.5).text_color(t.muted).cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.openPast(b.name, cx)).child(L("All history"))));
  }

  // History rows: the state, what it was about, when. A run's row opens its terminal or its last screen.
  entries(list, t) {
    if (!list.length) return [div().text_size(12).text_color(t.dim).child(L("No runs yet."))];
    const mono = settings().font_family ?? "JetBrains Mono";
    const tone = { running: t.working, blocked: t.blocked, done: t.ansi2, handled: t.ansi2, failed: t.ansi1, missed: t.ansi1, interrupted: t.ansi1 };
    return list.flatMap((r) => {
      const s = state(r);
      const what = r.status === "checked" ? (r.count > 1 ? L("{0} rounds, nothing new since {1}", r.count, hm(new Date(r.from))) : this.found(r))
        : [r.item, r.note && L(r.note)].filter(Boolean).join(": ") || L(r.trigger);
      return [h_flex().id(`h-${r.id}`).gap(8).px(6).py(5).rounded(6).items_center().cursor_pointer().hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => this.show(r, cx))
        .child(div().size(6).flex_none().rounded_full().bg(tone[s] ?? t.dim))
        .child(div().w(64).flex_none().text_size(11.5).text_color(tone[s] ?? t.muted).child(L(s)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(what))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(r.at))),
      ...(this.output?.id === r.id ? [div().p(8).rounded(7).bg(t.background).text_size(11).text_color(t.muted)
        .font_family(mono).child(this.output.text)] : [])];
    });
  }

  // The All history page: one day at a time, newest first, read from the day files.
  openPast(name, cx) {
    const p = this.past = { name, days: null, i: 0, rows: null };
    this.output = null;
    cx.notify();
    cx.spawn(async (cx) => { p.days = await historyDays(name); await this.readDay(p); cx.notify(); });
  }

  async readDay(p) {
    p.rows = null;
    p.rows = p.days[p.i] ? await historyDay(p.name, p.days[p.i]) : [];
  }

  renderPast(t) {
    const p = this.past, day = p.days?.[p.i]?.replace(".jsonl", "");
    const step = (id, label, to) => this.button(id, label, t, (cx) => {
      if (to < 0 || to >= p.days.length) return;
      p.i = to;
      cx.spawn(async (cx) => { await this.readDay(p); cx.notify(); });
      cx.notify();
    });
    return v_flex().p(14).gap(10)
      .child(h_flex().gap(8).items_center()
        .child(step("past-older", "‹", p.i + 1))
        .child(div().flex_1())
        .child(div().text_size(12.5).font_medium().child(day ?? ""))
        .child(div().flex_1())
        .child(step("past-newer", "›", p.i - 1)))
      .child(v_flex().p(12).gap(2).rounded(10).bg(t.raised)
        .children(p.rows ? this.entries(fold(p.rows), t) : [div().text_size(12).text_color(t.dim).child(L("Loading…"))]));
  }
}
