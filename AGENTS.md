# herdr-scheduler

A schedule engine that lives inside the Herdr app as one mod: no daemon, no launchd, no CLI to install.
A schedule is one JS file. It fires at set times and gives an agent a prompt in an existing space, a new
worktree, or a background `hc` terminal, or (a code schedule) polls for items and handles each new one with
its own code. Public repo, MIT.

Built: prompt schedules, code schedules, the panel with its form, and the headless copy.
`app/RECIPE.md` describes all of it; when behavior changes, change the recipe in the same commit.

## Layout

- `app/`: exactly what herdr.dev/mods shares: `mods/herdr-scheduler/`, `RECIPE.md`, `preview.png`.
- `app/mods/herdr-scheduler/`: the mod.
  - `main.js`: the panel `View`, the tick timer, engine start.
  - `engine.js`: loading schedules, running them (the three places, `hc`), code schedule rounds and `ctx`, history.
  - `schedule.js`: schedule parsing and next-run time, a poll's items and the seen keys. Pure: no
    `herdr` or `gpui-kit` import.
  - `schedule.test.js`: `node --test` cases for `schedule.js`.
  - `i18n.js` and `i18n.test.js`: the panel's languages (English and Korean), and the test that every
    string the code shows has a text in each.
  - `prompt.js`: the prompt the Add script page gives an agent. It describes the script format, so it
    changes whenever the format or `ctx` does.
  - `settings.svg`, `plus.svg`, `script.svg`, `pencil.svg`, `trash.svg`: the icons.
  - `examples/`: example schedules. They ship inside the mod because whoever adds a mod copies only
    `mods/<name>/`.
  - `jobs/`: the user's schedules. Gitignored, never in this repo.
- `README.md` and `README.ko.md` (same content in English and Korean), and `docs/screens.png`, the four
  screens the READMEs show.

Split a file only when it earns it (`run.js` out of `engine.js` once the three places get long).

## Rules

- The mod is the whole product. Don't add a CLI, a daemon, an install script or a config file outside
  the mod folder. If something seems to need one, stop and raise it.
- Schedules load only from `jobs/` inside the mod folder: Herdr blocks imports from outside it, and
  `new Function` is disabled. A broken schedule file stops that schedule only and shows in the panel.
- The schedule file format and `ctx` are the public API: adding a field is cheap, changing or removing one
  breaks people's schedules. Code schedules get only `ctx` (built in `api()` in `engine.js`) and never import
  `herdr`, for the same reason. Keep `ctx` small.
- Run once: several copies of the mod share one JS thread, so the engine reads `shared(key)` and calls
  `setShared` with no `await` in between before every run and every handled item (`scheduler.slots`,
  `scheduler.seen`). Keep that pair together.
- Start the engine in `init`, not at module top level: module code runs once per source version and is
  shared by copies, and a broken save has already run it.
- Saving any file in the mod folder reloads the mod and restarts its timers. So the mod writes into its
  own folder only when the person saves or deletes a schedule in the form (`jobs/<name>.js`, and the reload is
  how the list updates), and the first tick is a full 30 seconds after a load.
- State goes in `shared` under `scheduler.*` (`slots`, `paused`, `next`, `history`, `seen`, `state`). Every
  `setShared` redraws every mod: write only when something changed, never on each tick.
- Every run goes through one `hc run --bg --no-parent`. A tab or a space is made by the labels
  `herdr.space` and `herdr.tab` (an unknown id becomes a new one), which doesn't take focus. Don't use
  `space.new` or `tab.new`: they do.
- Background runs start the agent, `hc wait`, then `hc send`. A prompt passed in argv is typed but not
  sent. Don't write to the user's `~/.config/herdr-core/templates`.
- Nothing personal in the repo: no private repo names, clone paths, skill names or prompts in code,
  examples, docs or `preview.png`. Those live in the user's own `jobs/`.
- No `setTimeout`, no top-level `await`, never keep a `cx`. Timers are for data; animate natively.
  The rest of the mod API is in `~/.config/herdr-app/AGENTS.md` and its `.d.ts` files.

## After a change

- `node --test app/mods/herdr-scheduler/schedule.test.js app/mods/herdr-scheduler/i18n.test.js` after any
  change to the mod's code. Add a case for new behavior.
- Text the person sees goes through `L("English text", ...args)` and gets its Korean in `i18n.js` in the
  same change. English is the key, so never build a shown sentence by concatenation: use `{0}`.
- The installed copy isn't linked (Herdr doesn't reload through symlinks). Copy and check it:
  `cp -R app/mods/herdr-scheduler ~/.config/herdr-app/mods/ && herdr-app check ~/.config/herdr-app/mods/herdr-scheduler`,
  then `herdr-app status` for errors. The copy leaves the installed `jobs/` alone.
- `herdr-app check` renders once and runs no timer. Engine behavior (a run, catch-up, pause, reload on
  save, a code schedule's round) is checked in the app with a throwaway `zz-*` schedule on `{ every: "1m" }`; a
  code schedule's `poll` can read its items from a scratch JSON file through `ctx.exec("cat", …)`, so they
  change without a reload. `herdr-app shot` shows the window.
- Clean up test terminals with `hc kill` and `hc rm`, by address, after checking their
  `scheduler.bot` label with `hc get`. Remove test schedules from the installed `jobs/` first, or they keep starting.
- Docs: change both READMEs; change `app/RECIPE.md` when the panel's look or behavior, `ctx`, or what
  the mod reaches changes. `examples/worktree-cleanup.js` documents the code schedule format and `ctx` in its
  comments: keep it in step.

## Commits

- Commit messages are in English, whatever language the conversation is in: `type: summary` in the
  imperative (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`), under 72 characters, with a body only
  when the why isn't obvious. PR titles and bodies are in English too.

## Sharing the mod

- herdr.dev/mods lists a public GitHub repo with the topic `herdr-mod` within the hour of a push, so
  once the topic is on, a push to `main` publishes `app/` as it is. A folder below the root is listed
  as `<repo>--<folder>`: `herdr.dev/mods/kimsuhan/herdr-scheduler--app`.
- Don't add the topic or push without being asked. Add the topic only when `app/` is complete:
  a passing `herdr-app check`, `RECIPE.md` written from the real files, `preview.png`.
- `app/` holds `mods/herdr-scheduler/`, `RECIPE.md`, `preview.png`. No `layouts/` folder; a `keys.json`
  only if the mod starts expecting keys (it doesn't).
- `RECIPE.md` is the brief another agent builds the mod from with an empty folder. Keep the order
  `~/.config/herdr-app/AGENTS.md` gives ("Layouts and mods other people made"): name, paragraph and
  preview, What you see, How it behaves, Built from, Watch out, Done when. Exact values, nothing the
  build doesn't do. It must cover the schedule file format and `ctx`, or a rebuild can't run existing schedules.
- Whoever adds the mod is told what it reaches. Keep a "Before you add it" section true: it runs
  programs (`hc`, `git`, and whatever a schedule runs), schedules are arbitrary code the person puts in `jobs/`,
  it runs only while Herdr is open and a copy has been shown in the shown layout (a mod starts the
  first time it shows; `props: { headless: true }` is the copy for layouts that hide the panel).
- `preview.png` is the gallery thumbnail: the product's name and a line at the left, a real screenshot of
  the list at the right, generated from that screenshot. `docs/screens.png` is four real screenshots side
  by side. Both show example schedules only, in English: move the real `jobs/` files away, copy examples
  in, shoot within 30 seconds (before the first tick) and move them back. Retake both when a screen changes.

## Known gaps

- Schedules run per machine; spaces on other machines and runs while Herdr is closed are out of scope.
- A background agent blocked on a permission question has no pane: it only shows in the panel.
- An `agent` that reports no status (a plain shell) never gets its prompt: the run fails after 2 minutes.
- The form writes a schedule as plain data: editing a hand-written file through it drops the file's comments.
  It can't rename a script (only a prompt schedule), and agent arguments with spaces need the file. There is no pause-all.
- History in `shared` is capped at 50 per schedule. If redraw cost shows, move it to a file outside the mod folder.
- A code schedule remembers 500 keys; a poll that keeps returning more than 500 distinct live keys hands the
  oldest out again. Nothing forgets a key on purpose, and removing a schedule leaves its `seen` and `state`.
- `ctx.start` and `ctx.send` work in `handle` only. "Run now" runs a whole round, not one item.
- A `handle` running over 5 minutes reads "interrupted" until it returns.
- The form can't make a code schedule or edit its code: for one it changes only the schedule and the about
  line, as an override in shared `scheduler.overrides` (read through `current()` in `engine.js`), so the
  file and what runs can differ.
