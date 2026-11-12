// A code schedule: copy this file to ../jobs/<name>.js and edit it. The file name is the schedule's name.
// Instead of a prompt it has functions. On every slot the scheduler runs one round:
//   1. ended(thread, ctx), if there is one, for each live terminal holding one of this schedule's threads;
//   2. poll(ctx), which returns items: [{ key, thread?, ...anything }];
//   3. handle(item, ctx) for each item whose key this schedule has not seen before, one after another.
// A key is handled once, ever (the newest 500 keys are remembered per schedule). Before each item the
// round stops if one of the schedule's agents is working or waiting, so a schedule that starts agents takes one
// item at a time; the rest come back unseen in a later round. A late slot simply runs: a round is
// safe to repeat, so there is no catchUp.
//
// This one marks worktree spaces whose pull request is merged or closed. It deletes nothing: it
// keeps what it found in Herdr's shared state, under "scheduler.state" -> { "<schedule name>": { ended:
// { <folder>: pr } } }, where another mod (a sidebar's trash button) can read it, and it notifies you.

export default {
  // Optional: a line the panel shows on the schedule's page.
  about: "Tells you when a worktree space's pull request is merged or closed. Deletes nothing.",

  // Any schedule a prompt schedule takes.
  schedule: { every: "5m" },

  // What there is now. Called with ctx, never with Herdr itself:
  //   ctx.exec(cmd, args, { cwd, timeout })  runs a program: { code, stdout, stderr }
  //   ctx.spaces(), ctx.panes(), ctx.terminals()  Herdr's live spaces, panes and terminals
  //   ctx.home  your home folder
  //   ctx.state.get(key), ctx.state.set(key, value)  this schedule's own store (undefined removes a key)
  //   ctx.notify({ title, body, level })  level: info, success, warning, error
  //   ctx.skip(item, why)  a history row saying an item was skipped, and why
  async poll(ctx) {
    const root = `${ctx.home}/.herdr/worktrees/`, found = [], ended = {};
    for (const space of ctx.spaces()) {
      if (space.machine || !space.branch) continue; // another machine's, or no branch to ask about
      const tabs = new Set(space.tabs.map((t) => t.id));
      const cwd = ctx.panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd ?? space.folder;
      const rest = cwd?.startsWith(root) && /^[^/]+\/[^/]+/.exec(cwd.slice(root.length)); // <repo>/<name>
      if (!rest) continue;
      const folder = root + rest[0];
      const r = await ctx.exec("gh", ["pr", "view", space.branch, "--json", "state,number,url"], { cwd: folder });
      if (r.code !== 0) continue; // no PR yet, or gh failed: ask again next round
      const pr = JSON.parse(r.stdout);
      // The state is in the key, so a PR that is reopened and closed again is a new item.
      if (pr.state === "OPEN") continue;
      ended[folder] = pr;
      found.push({ key: `${folder}@${pr.state}`, folder, space: space.name, ...pr });
    }
    // The whole picture on every round, so a worktree that is gone or reused drops out of it.
    ctx.state.set("ended", ended);
    return found;
  },

  // One new item. ctx has the same as in poll, plus:
  //   ctx.start({ where, agent, prompt, thread? })  starts an agent like a prompt schedule's run (same
  //       where forms) and resolves with its terminal's address. With `thread`, the terminal is
  //       labelled scheduler.thread=<schedule name>:<thread> and holds that thread.
  //   ctx.thread(name)  the live terminal holding that thread, or null. Label a terminal of your own
  //       that way (hc label <terminal> scheduler.thread=<schedule name>:<thread>) to make it the owner.
  //   ctx.send(terminal, text)  continues that terminal's conversation
  // The item's history row reads "handled", "skipped", "failed" (it threw), or follows the agent
  // that ctx.start or ctx.send gave it.
  async handle(item, ctx) {
    ctx.notify({ title: `PR #${item.number} ${item.state.toLowerCase()}`, body: `${item.space} can be removed.`, level: "info" });
  },

  // Optional: whether a thread is finished. True removes its label, and the terminal is no longer
  // the thread's (an idle background one is ended on the schedule's next background start). This schedule
  // starts no agents, so it has none:
  // async ended(thread, ctx) { return true; },
};
