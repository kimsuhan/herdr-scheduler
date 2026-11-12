# Scheduler

A side panel that runs schedules: each schedule gives a coding agent a prompt at set times (every day at 09:00,
weekdays, chosen days, every N minutes), in the background, in a new tab of a space, or in a git
worktree. A code schedule instead polls for items at its times and handles each new one with its own
code, which may start an agent or continue an earlier agent's conversation. A schedule is one JS file in the
mod's `jobs/` folder, written by hand or by the panel's form; saving it is all the setup there is. The
panel lists the schedules with their next run, makes, edits, runs or pauses one, and keeps each one's history.
There is no daemon, cron entry or CLI: the mod is the scheduler, so schedules run while Herdr is open.

![Scheduler](preview.png)

## Before you add it

The mod **runs programs**: `hc` to start each agent, wait for it, send its prompt, label it, read it
back and end it, and `git` (`fetch`, `worktree add`, `checkout --detach`, `rev-parse`) for worktree schedules.
Each schedule starts **the command its file names** with **the prompt its file holds**. A code schedule **runs
its own JavaScript** inside Herdr on every round, with **whatever programs it calls** through `ctx.exec`
(the example calls `gh`), and can start agents and type into terminals that hold its threads. Read a schedule
before putting it in `jobs/`. The mod reads the folder `~/.herdr/worktrees/<repo>/<name>` to see if a
checkout exists. It reaches no network itself (`git fetch`, the agents and a code schedule's programs do).
The only files it writes or deletes are the schedules in its own `jobs/` folder, when you save or delete one
in the form; its state is in Herdr's shared state under `scheduler.*`.

Schedules run only while Herdr is open and a copy of this mod has been shown once in the shown layout. A
panel that isn't always shown (a child of a stack, a pane in another tab) only starts when someone looks
at it: for those layouts add a second copy with `props: { headless: true }` in a floating block. It
draws nothing and runs the schedules:

```json
"floating": [{ "id": "scheduler-engine", "content": { "mod": "herdr-scheduler", "props": { "headless": true } }, "edge": "bottom", "align": "end" }]
```

## What you see

A card filling its block: `rounded(10)`, 1px `border`, `background`, 13px text in `foreground`.
Top to bottom:

- **Header**, 42px, 14px side padding, 1px `border` below: "Scheduler" semibold on the left, and on the
  right "N schedules" (11px, `dim`). In a schedule's detail, the form or the settings it shows a 24px
  "‹" button and the schedule's name, "New schedule" or "Edit <name>".
- **Timeline**, at the top of the list: 14px side padding, 1px `border` below. A title row, "Timeline"
  (10.5px semibold `dim`) and at the right the next run on the line in `foreground`, "15:00
  hourly-digest" ("+2" after it when two more run in that hour). Under it one 14px line of 30 equal
  cells, an hour each: the last six hours, the current hour, the next twenty-three. The line is 1px,
  `border` in the past and `input` from now on. Now is a 2px by 14px `foreground` bar. Left of it a 6px
  dot in each hour something ran: `ansi2`, or `ansi1` when a run in it failed, was missed or was
  interrupted. Right of it an 8px `accent` ring in each hour schedules run, filled for the next one. A
  1px by 5px `dim` tick every six cells, and under the line five 10px `dim` labels: the clock time at
  each tick ("06:00", "18:00") and "now". A dot's tooltip lists the times and names. Schedules that
  run more than hourly, and paused or broken ones, have no rings.
- **Schedule list**, scrolling, in up to four sections in this order: Running (working or blocked),
  Needs attention (broken, failed, missed, interrupted), Upcoming (soonest first), Paused. A section's
  name and count (10.5px semibold `dim`) show only when more than one section has rows. One row per
  file in `jobs/`: 8px side margin, 10px left and 8px right padding, 10px gaps, `rounded(8)`, a 2px
  left border, `hover` background on hover:
  1. the name (13px medium, truncated) over one 11px `muted` line, the schedule and the place,
     "weekdays 09:00 · background" ("· code" for a code schedule); when the file is broken or the last
     run failed, that line is the reason in `ansi1`;
  2. right-aligned: the time left as a timer in the terminal font, 12px (`foreground` in its last hour,
     else `muted`), "20:37:40", "2:40", or the state's word in its color in place of the timer; under
     it in 10.5px `dim` when the last run was, "1h ago", after a 5px dot (`ansi2` when it is done or
     handled, `ansi1` when it failed, was missed or interrupted), or for a code schedule "checked 2m
     ago";
  3. a 24px "▶" with no frame (`dim`; `raised` background and `foreground` on hover).
  A schedule in a state (running, blocked, paused, gone wrong) has a `raised` background and its left
  border in the state's color; the others are plain, with the border in `background`. A broken file
  has only the name and the reason.
- **Empty**: "No schedules yet." and how to make one with "Add schedule" or copy one from `examples/` to `jobs/`.
- **Footer**, on the list only, drawn like the two rows at the foot of Herdr's sidebar: 1px `border`
  above, padding 8px sides, 4px top, 8px bottom; two 28px rows (`rounded(8)`, 8px padding, 9px gap, a
  14px icon then the label in 13px; `hover` background and `foreground` on hover): a gear and "Settings"
  in `muted`, a plus and "Add schedule" in `dim`.
- **Settings** (after clicking "Settings"): the header's "‹" and "Settings"; a "Language" label (11px
  semibold `dim`) over two pills, "English" and "한글".
- **Detail** (after clicking a row), 14px padding, 10px gaps: "Run now" (`solid`), "Pause"/"Resume",
  "Edit" and "Delete" buttons; the schedule's `about` line if it has one (12px `muted`); four lines Schedule,
  Next, Where, Agent (64px `dim` label, value truncated); the prompt in a `raised` box, 12px `muted`;
  "History" (11px semibold `dim`); one row per run, newest first: its state (70px), the trigger or the
  failure, and when. A code schedule has no Edit, no Where, Agent or prompt, and a third line Runs, "code:
  poll, handle" (", ended" when it has one), and a fourth, Checked, "2m ago: 3 items, 0 new" ("failed"
  when the round threw, "not since the last reload" before its first); its rows show the item's key,
  then ": " and the note when there is one.
- **Form** ("Add schedule" or "Edit"), 14px padding: 11px semibold `dim` labels over 30px inputs (`rounded(7)`, 1px
  `input` border, `surface`) and 24px pills (`selected` with an `accent` border when on). Top to bottom:
  Name (new schedules only); About; Repeat pills Daily, Weekdays, Days, Every; day pills Mo to Su for Days;
  Time and "Catch up a missed run within", or Interval for Every; Where pills Background, Space, Worktree with a
  folder input and "Choose…", a pill per space on this machine, or a repository input with Commit/Branch
  pills and a rev; Agent command; Prompt (a text area, 4 to 12 lines); a red line saying what is wrong;
  Cancel and Save (`solid`).

## How it behaves

- A row's left border and the word in place of its timer say what a schedule is doing: `working` color and "running" while its agent
  works, `blocked` color and "blocked" while it waits on the person, `dim` and "paused", `ansi1` and
  "failed", "missed" or "interrupted" when the last run went wrong, `ansi1` and the error when the file
  is broken, otherwise `idle`. The state's word takes the timer's place; with no word the timer counts
  down every second, `h:mm:ss` or `m:ss`. The detail's Next line shows the same timer.
- Clicking a dot on the timeline opens the first schedule that ran or runs in that hour.
- Every 30 seconds each schedule's current slot (the latest scheduled time that has passed) is compared with
  the last slot seen. A new slot runs if it is at most 90 seconds old, or at most `catchUp` old when the
  schedule sets one (trigger "catch-up"); older than that it becomes a "missed" row. A schedule seen for the first
  time doesn't run until its next slot. A slot is skipped without a row while the schedule is paused or its
  previous run is still starting, working or blocked.
- A run starts the agent with `hc run --bg --no-parent`, waits until it reports idle, then sends the
  prompt with `hc send`. Nothing takes the window's focus.
  - `background`: no pane anywhere.
  - `space`: a new tab in that space, started in the folder of the space's first pane.
  - `worktree`: a space on `~/.herdr/worktrees/<repo folder name>/<name or schedule name>`, made if absent.
    With `commit` the repo is fetched and the checkout detached at it on every run; with `branch` (default:
    the name) the branch is created from the repo's HEAD if new and left alone afterwards. If a space
    already shows that folder, the run is a new tab in it.
- A run that can't start (no such space, git error, an agent that asks something before the prompt or
  isn't ready in 2 minutes) is a "failed" row with the reason, and an error notification.
- A round that finds nothing new leaves no history row, so the panel keeps what each code schedule's last
  round found (how many items `poll` returned, how many were new) in memory and shows it as "checked".
  A reload forgets it until the next round.
- A code schedule's slot runs one round instead of a run. A late slot simply runs (no "missed" rows, no
  catch-up), and a busy schedule still runs its rounds. Two rounds of one schedule never overlap. A round:
  1. If the schedule has `ended`, it is called for each live terminal labelled `scheduler.thread=<name>:<thread>`;
     when it returns true the label is removed (`hc label <t> scheduler.thread=`).
  2. `poll` returns items. Nothing counts as none; anything but an array, or an item without a `key`, is
     a failure. Keys are made strings.
  3. Each item in order: the round stops if the schedule is busy (a live terminal labelled with the schedule or one
     of its threads is working or blocked) or a row of it is starting; an item whose key is in
     `scheduler.seen` is passed over; otherwise its key is written there (before anything is awaited)
     and `handle` runs. The round also stops after an item whose `handle` gave an agent work
     (`ctx.start` or `ctx.send`), since the agent may not report working yet. Items it didn't reach come
     back in a later round.
- Each handled item is a row (trigger "poll", the key in `item`), "starting" while `handle` runs. When it
  returns the row follows the terminal `ctx.start` or `ctx.send` gave it, like a prompt run's, or reads
  "handled"; `ctx.skip` makes it "skipped" with the reason; a throw makes it "failed" with the message and
  an error notification "<schedule> failed on <key>".
- A `poll` or `ended` that throws ends the round. It is a "failed" row (trigger "poll") and an error
  notification "<schedule> failed", unless the schedule's newest row is already "failed" with the same message.
- History states: starting, running, blocked, done (the agent is idle again), ended (its terminal is
  gone, or a later item's `ctx.send` took it), failed, missed, interrupted (a start cut off by a reload,
  or a `handle` running over 5 minutes), handled, skipped.
- "▶" and "Run now" start the schedule at once, paused or not: a code schedule runs a round. "Pause" stops
  scheduled runs and rounds of that schedule.
- The form checks what is typed as it is typed and shows the first problem; Save does nothing while
  there is one. Save writes `jobs/<name>.js` as `export default { … };` (JSON), which reloads the mod
  and brings the list back with the schedule in it. A new schedule can't take a name that is there. "Edit" is
  offered for schedules whose file has no functions; it keeps the name. "Delete" asks once ("Really delete"),
  then removes the file. "Choose…" opens the system's folder picker.
- Picking a language sets shared `scheduler.lang` (`en` or `ko`; unset is English) and every copy of the
  panel redraws in it at once: labels, buttons, states, "5m ago" times ("5분 전"), schedules ("평일
  09:00", "5분마다"), validation and start failures, and notifications. Names, prompts, `about` lines,
  item keys and a program's own error output stay as they are. History notes are stored in English and
  translated when shown.
- Clicking a history row: a background run still alive opens in a peek (`terminal.peek`); a run in a
  tab is gone to (`pane.focus`); an ended run's last 200 lines are read back and shown under the row in
  the terminal font (click again to fold).
- Before each background run, that schedule's earlier background agents that are no longer working are
  ended, except one still holding a thread, and of its ended ones only the newest 5 stay readable (one
  that `hc rm` refuses, still live, is tried again next time).
- A schedule whose file is gone takes its history, seen keys, state and pause with it on the next tick
  (unless no schedule is left at all: an unreadable `jobs/` looks the same).
- Saving a file in `jobs/` reloads the mod: the list follows at once and the next tick is 30 seconds later.

## Built from

- One mod, `mods/herdr-scheduler/`, `mod.json` `{ "place": "right", "size": 340 }`. One optional prop,
  `headless: true`: that copy renders an empty `div()` and only runs the schedules. No layout, no keys, no
  shipped mods. Art: `settings.svg` and `plus.svg`, the Lucide icons of those names (24px, stroke 2,
  `currentColor`), drawn with `svg("mods/herdr-scheduler/<name>.svg")` so they take the text color.
- `schedule.js`, pure: `duration("2h")`; `parse(schedule)` to `{ every: ms }` or `{ days, at: minutes }`;
  `slot(p, now)` and `next(p, now)` (`every` is counted from the epoch, times of day are local);
  `due(p, last, now, grace)`; `describe(p)`; `items(list)` (a poll's result checked); `remember(seen,
  key, now, cap = 500)` (the seen keys with one added, the oldest dropped past the cap).
  `schedule.test.js` covers them with `node --test`.
- `i18n.js`, pure: `LANGUAGES`; `say(lang, key, ...args)`, where the English text in the code is the key
  and `{0}`, `{1}` are filled in. A language is a map from key to text plus patterns for messages with a
  value inside (`"25:00" is not a time (09:30)`, `every 5m`). `main.js` and `engine.js` wrap it as
  `L(key, ...args)`. `i18n.test.js` scans the code for every `L("…")` key and every plainly thrown
  message and fails if a language lacks one.
- `engine.js`: `load()` reads `jobs/` with `fs/promises` `readdir` and imports each file with
  `import(["./jobs/", file].join(""))`; `tick(bots)` returns what to start; `start(bot, trigger)` (a run,
  or a code schedule's round); `state(row)`; `busy(name)`; `where(w)`; `lastRound(name)` (what a code schedule's
  last round found, kept in a module-level object); `setPaused(name, on)`; `check(bot)` (a code schedule
  checks to `{ schedule, code: true }` and is called through its file's object, so `this` works);
  `save(name, bot, fresh)` and `remove(name)` with `fs/promises` `exists`, `mkdir`, `writeFile`, `unlink`.
- `main.js`: the `View`, `cx.timer.every(30000)` for the engine and `cx.timer.every(1000)` to redraw the
  timers (not in the headless copy), the list, detail and form (`InputState`, `Input`,
  `TextareaState`, `Textarea` from `gpui-base`).
- A schedule file default-exports:
  ```js
  export default {
    about: "…",                        // optional: a line shown on the schedule's page (code schedules too)
    schedule: { weekdays: "09:00" },   // { daily } | { days: [1, 3], at } (0 = Sunday) | { every: "30m" }
    catchUp: "2h",                     // optional
    where: { background: true, cwd: "~/code/my-repo" },
                                       // { space: "<name or id>", cwd? } | { worktree: { repo, commit | branch, name? } }
    agent: ["claude", "--model", "haiku"],
    prompt: "…",
  };
  ```
  or a code schedule (`examples/worktree-cleanup.js`):
  ```js
  export default {
    schedule: { every: "5m" },
    async poll(ctx) { return [{ key: "…", thread: "…" /* optional */, ...data }]; },
    async handle(item, ctx) { … },
    async ended(thread, ctx) { return true; },   // optional
  };
  ```
- `ctx`, the only API a code schedule gets (it never imports `herdr`):
  - `exec(cmd, args, { cwd, timeout })`: herdr's `exec`. `notify({ title, body, level })`. `spaces()`,
    `panes()`, `terminals()`: herdr's, as they are. `home`: the home folder.
  - `state.get(key)`, `state.set(key, value)`: the schedule's store in `scheduler.state`; `set` writes only
    when the value changes, and `undefined` removes the key.
  - `thread(name)`: the address of the live terminal labelled `scheduler.thread=<name>:<name>`, or null.
  - `skip(item, why)`: in `handle` the item's row becomes "skipped" with `why`; elsewhere a new
    "skipped" row.
  - In `handle` only (elsewhere they throw "ctx.start works in handle only"):
    `start({ where, agent, prompt, thread? })`, checked like a prompt schedule's and started the same way, plus
    the label `scheduler.thread=<name>:<thread>`; resolves with the address, rejects with the reason.
    `send(terminal, text)`: `hc send <t> <text>` (rejects if it fails), then `hc label <t>
    scheduler.run=<the item's row>`.
- `herdr`: `hc`, `exec` (git), `appHome`, `home`, `shared`, `setShared`, `terminals`, `spaces`, `panes`,
  `notify`, `run`, `theme`, `settings`, `pickFolder`, `props`. Commands: `terminal.peek`, `pane.focus`.
- `hc`: `run --bg --no-parent --json --cwd <dir> --label … -- <agent>`, `wait <t> --timeout 20 --json`,
  `send <t> <prompt> --if idle --json`, `send <t> <text>` (`ctx.send`), `label <t> k=v`, `read <t> --lines
  200`, `kill <t>`, `rm <t>`.
- Labels on every run's terminal: `scheduler.bot=<name>`, `scheduler.run=<id>`; runs in a tab also get
  `herdr.space=<id>` and `herdr.tab=tb<32 hex>`, which is what puts them there. A code schedule's thread:
  `scheduler.thread=<name>:<thread>`, which a person may also put on a terminal by hand.
- Shared state: `scheduler.slots` `{ name: ms }`, `scheduler.paused` `{ name: true }`, `scheduler.next`
  `{ name: ms }` (for other mods), `scheduler.history` (rows `{ id, bot, at, trigger, where?, status,
  item?, terminal?, note?, removed? }`, newest first, 50 per schedule), `scheduler.seen` `{ name: { key: ms } }`
  (500 per schedule), `scheduler.state` `{ name: { key: value } }` (for other mods), `scheduler.lang`.

## Watch out

- Herdr only imports files inside the mod folder (no absolute paths, no `data:` URLs, no `new
  Function`), which is why schedules live in `jobs/` and the import path is built at run time.
- A prompt passed in the agent's argv is typed but not sent. Start the agent bare, wait, then `hc send`.
- `tab.new` and `space.new` take the window's focus. The `herdr.space` and `herdr.tab` labels don't,
  and an id Herdr doesn't know becomes a new space or tab.
- Several copies of the mod share one JS thread: write the slot to `scheduler.slots`, and an item's key
  to `scheduler.seen`, in the same synchronous stretch that read it, before any `await`, or two copies
  start the same run or handle the same item.
- Right after `hc send` an agent may still report idle, so a busy check alone lets a round hand out a
  second item at once: stop after an item that gave an agent work.
- A thread's terminal must survive the schedule's next background start: the cleanup skips terminals with a
  `scheduler.thread` label, and `ended` is what lets them go.
- Every `setShared` redraws every mod. Write `scheduler.slots` and `scheduler.next` only when they
  differ from what is there.
- A save in the mod's folder reloads it, so the only writes are the form's, and state never goes there.
- A schedule's seen keys go with its file: move a code schedule out of `jobs/` and back, and items still returned
  by its `poll` are handled again.
- The headless copy relies on a floating block's mod starting although it draws nothing.
- The form splits the agent command on spaces and can't rename; editing a hand-written file through it
  drops its comments.
- A program that never reports a status (a plain shell as `agent`) is never "ready": the run fails after
  2 minutes. Schedules are for agents.
- `hc rm` only removes ended terminals; history rows remember which they removed.
- It assumes `hc` and `git` on the PATH Herdr uses, and spaces on this machine only.
- A new string in the panel needs its text in every language of `i18n.js`, or it shows in English; the
  test catches a missing one only when the string is written as `L("…")`.
- Not built: pause all, editing a code schedule in the form, `ctx.start`/`ctx.send` outside `handle`, running
  one item at once (only a whole round), forgetting a seen key except by the 500 cap.

## Done when

- `node --test mods/herdr-scheduler/schedule.test.js mods/herdr-scheduler/i18n.test.js` passes and `herdr-app check mods/herdr-scheduler` passes.
- With `jobs/` empty the panel says "No schedules yet."; copying `examples/daily-prompt.js` in lists it with
  its schedule and a timer counting down within a second.
- A file with `daily: "25:00"` shows `"25:00" is not a time (09:30)` in red and the other schedules keep working.
- A schedule on `{ every: "1m" }` with `where: { background: true }` and a Claude agent gets its prompt
  answered within two minutes, with no new tab and the focused pane unchanged; its history row reads
  "done", and the next run ends the first one's agent.
- The same schedule with `where: { space: "<a space's name>" }` adds a tab to that space, and with
  `where: { worktree: { repo, branch } }` makes the checkout and a space on it; neither takes focus.
- "Pause" stops the runs and shows "paused"; "Resume" brings the timer back.
- "Settings" at the bottom of the list opens the settings; picking 한글 turns the whole panel Korean at
  once ("스케줄러", "스케줄 3개", "평일 09:00"), and English turns it back.
- "Add schedule" with a name, Daily 09:00, Background and a prompt saves `jobs/<name>.js` and the schedule is in the list;
  a time of 25:00 shows the problem and Save does nothing; "Delete" twice removes the file and the row.
- A code schedule on `{ every: "1m" }` whose `poll` returns fixed items lists as "code"; each new key is
  handled once across rounds; an item whose `handle` calls `ctx.start({ where: { background: true },
  agent, prompt, thread })` gets its prompt answered and the terminal carries `scheduler.thread`; a later
  item on that thread finds it with `ctx.thread` and `ctx.send` continues the same conversation; the next
  item after one that started or sent waits for the next round; `ended` returning true removes the
  label; a `poll` that throws makes one "failed" row, not one per round; `ctx.state.set` shows under
  `scheduler.state`.
