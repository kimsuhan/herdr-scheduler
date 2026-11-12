# herdr-scheduler

Scheduled prompts for your coding agents, inside the [Herdr](https://herdr.dev) app. One mod, one JS
file per schedule: no daemon, no cron entry, no CLI.

[한국어](README.ko.md)

![Scheduler](app/preview.png)

A schedule gives an agent a prompt at set times, in one of three places:

- **background**: no tab at all. Read the run from the panel's history.
- **space**: a new tab in a space you name.
- **worktree**: a space on a git worktree, fetched and checked out before every run.

Nothing takes your window's focus when a schedule starts.

## How it differs from a daemon

The mod is the scheduler, so schedules run **while Herdr is open** with the Scheduler panel in the shown
layout. If your panel isn't always visible (a tab of a stack, for example), add a headless copy that
only runs the schedules; [app/RECIPE.md](app/RECIPE.md) has the layout line. A run missed while Herdr was closed is caught up when it opens, if the schedule sets
`catchUp`. If you need runs with the app closed, use a daemon such as
[herdr-automations](https://github.com/DnzzL/herdr-automations).

## Install

In Herdr, ask your agent:

```
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/kimsuhan/herdr-scheduler/tree/main/app
```

Or by hand:

```sh
git clone https://github.com/kimsuhan/herdr-scheduler
cp -R herdr-scheduler/app/mods/herdr-scheduler ~/.config/herdr-app/mods/
```

The panel docks on the right the first time Herdr sees it. It needs `hc` (herdr-core) and, for worktree
schedules, `git`.

## A schedule

Press Add schedule at the bottom of the panel and fill the form, or copy `examples/daily-prompt.js` to `jobs/<name>.js` inside
the mod folder and edit it. Either way a schedule is that one file, and its file name is its name.

```js
// ~/.config/herdr-app/mods/herdr-scheduler/jobs/dependency-check.js
export default {
  schedule: { weekdays: "09:00" },
  catchUp: "2h",
  where: { background: true, cwd: "~/code/my-app" },
  agent: ["claude", "--model", "haiku"],
  prompt: "Check this repo's dependencies for known vulnerabilities and summarize what needs an upgrade.",
};
```

| Field | Values |
|---|---|
| `schedule` | `{ daily: "09:00" }`, `{ weekdays: "09:00" }`, `{ days: [1, 3], at: "09:00" }` (0 = Sunday), `{ every: "30m" }` (`m`, `h`, `d`) |
| `about` | optional: a line the panel shows on the schedule's page |
| `catchUp` | optional, `"2h"`: a run missed by less than this still runs. Without it a missed run stays missed |
| `where` | `{ background: true, cwd }`, `{ space: "<name or id>" }`, `{ worktree: { repo, commit } }` or `{ worktree: { repo, branch } }` |
| `agent` | the command to start, as an array |
| `prompt` | sent once the agent is ready |

Worktrees go to `~/.herdr/worktrees/<repo>/<schedule name>`, where Herdr's own worktree mod puts them.
`commit` (any rev, such as `origin/main`) is fetched and checked out detached on every run; `branch` is
created once and then left as the agent leaves it.

A schedule is code you put there, and it starts a program with a prompt on your machine: read one before you
install it.

## Code schedules

A schedule can run code instead of a prompt: on its schedule it polls for items and handles each new one.
Copy `examples/worktree-cleanup.js` (it marks worktree spaces whose PR is merged or closed) and read its
comments; they describe the format and `ctx` in full.

```js
export default {
  schedule: { every: "5m" },
  async poll(ctx) { return [{ key: "pr-12@merged", thread: "pr-12" }]; }, // items; each key is handled once
  async handle(item, ctx) {
    const t = ctx.thread(item.thread);            // the terminal holding that thread, or null
    if (t) return ctx.send(t, "It was merged. Wrap up.");
    await ctx.start({ where: { background: true, cwd: "~/code/my-app" }, agent: ["claude"], prompt: "…", thread: item.thread });
  },
  async ended(thread, ctx) { return false; },     // optional: true lets the thread's terminal go
};
```

`ctx` has `exec`, `start`, `send`, `thread`, `notify`, `skip`, `state.get`/`state.set` (kept in Herdr's
shared state under `scheduler.state`), `spaces`, `panes`, `terminals` and `home`. A schedule that starts
agents handles one item at a time: the rest wait for a later round. A code schedule runs any code and any
program on your machine, so read one before you install it. The form is for prompt schedules only.

## The panel

English or Korean: Settings, at the bottom of the panel.

- Each schedule with its schedule, next run and what it is doing. `▶` runs it now.
- Add schedule makes a schedule. Click a schedule: Run now, Pause, Edit, Delete, its settings and its history.
- Click a history row: a background run opens in a peek, a run in a tab is gone to, an ended run's last
  screen is shown in the panel.
- A schedule whose file is broken shows the error and doesn't run; the others carry on.

A schedule doesn't start a new run while its last one is still working or waiting on you. Before a background
run, the schedule's earlier idle background agents are ended, so they don't pile up.

## Remove

Delete `~/.config/herdr-app/mods/herdr-scheduler` (your schedules are in its `jobs/`) and the block from
your layout.

## Development

See [AGENTS.md](AGENTS.md). [app/RECIPE.md](app/RECIPE.md) describes the mod in full.

## License

MIT
