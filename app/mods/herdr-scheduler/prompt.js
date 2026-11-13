// The prompts the panel hands an agent to write or change a script (a code schedule) with the person.
// They say how scripts work and where things are, and make the agent ask what to build or change: the
// panel can't know that. Pure: no herdr or gpui-kit import. `dir`: the mod's folder. `language`: what
// the agent talks in.
export const scriptPrompt = (dir, language) => `Help me add a script to herdr-scheduler, a Herdr app mod that runs things on a schedule.

First, ask me what the script should do. Do not guess and do not write anything yet. Ask one or two questions at a time until you know:
- what it should check or watch, and how often;
- what counts as a new item there (so the same thing is not handled twice);
- what should happen for each new item: start an agent with a prompt, continue an earlier agent's conversation, only notify me, or only record something;
- when an item is finished, if it starts agents that should be let go later.
Talk to me in ${language}.

Then read these two files, comments included:
1. ${dir}/examples/worktree-cleanup.js: the script format and every ctx function.
2. ${dir}/examples/daily-prompt.js: the schedule and where forms.

What a script is:
- One file, ${dir}/jobs/<name>.js. The file name is its name in the panel. Saving the file is all the setup: the panel reloads by itself.
- It default-exports { about, schedule, keepHistory, async poll(ctx), async handle(item, ctx), async ended(thread, ctx) }. ended and keepHistory ("30d", the default: days of history kept) are optional; about is one line saying what it does.
- At each scheduled time, poll returns items [{ key, ...data }], and handle runs once for each key never seen before. Put into the key whatever should make an item count as new again.
- It may use only ctx: exec, start, send, thread, notify, skip, state, spaces, panes, terminals, home. No imports, no setTimeout, no top-level await, nothing kept between rounds except through ctx.state.
- ctx.exec(cmd, args, { cwd, timeout }) stops a program after 30 seconds unless timeout (ms, at most 600000) gives it more: give a slow download or build enough.
- Values that are mine (repo paths, names, prompts) go in constants at the top of the file.
- A script must not delete, push, post, merge or pay on its own. If what I ask needs one of those, ask me first and say so in its about line.

When the file is written:
- Run "herdr-app check ${dir}" and "herdr-app status"; the errors list must be empty.
- Tell me the script's name, how often it runs, and exactly what its first round will do. Nothing runs before its next scheduled time; I can press the play button on its row in the panel to run a round now.
`;

// For an existing script, `name`: the agent reads it, asks what to change, and changes only that.
export const editPrompt = (dir, name, language) => `Help me change a script of herdr-scheduler, a Herdr app mod that runs things on a schedule.

The script is ${dir}/jobs/${name}.js. Read it first, comments included. Then tell me in two or three sentences what it does now, and ask me what I want changed. Do not guess and do not edit anything yet. Ask one or two questions at a time until the change is clear. Talk to me in ${language}.

If the format or a ctx function is unclear, read ${dir}/examples/worktree-cleanup.js (the script format and every ctx function, in its comments) and ${dir}/examples/daily-prompt.js (the schedule and where forms).

Rules for the change:
- Change only what I ask for. Keep the rest of the file, its comments and its style as they are.
- Keep the file's name: it is the script's name, it is in the labels of the terminals that hold its threads, and other mods may read its state under that name.
- A script default-exports { about, schedule, async poll(ctx), async handle(item, ctx), async ended(thread, ctx) } and may use only ctx: exec, start, send, thread, notify, skip, state, spaces, panes, terminals, home. No imports, no setTimeout, no top-level await, nothing kept between rounds except through ctx.state.
- Each key that poll returns is handled once, ever. If the change alters what the keys look like, every item still there counts as new and is handled again on the next round: tell me before you do that, and say what would be handled again.
- The panel may hold its own schedule and about line for this script, laid over the file's. If I only want the times or the description changed, tell me to use Edit in the panel instead, or Reset to the file there if the file's values should win.
- A script must not delete, push, post, merge or pay on its own. If what I ask needs one of those, ask me first and say so in its about line.

When the file is changed:
- Run "herdr-app check ${dir}" and "herdr-app status"; the errors list must be empty.
- Show me what changed, and tell me exactly what the next round will do differently. Saving the file reloads the panel by itself; I can press the play button on the script's row to run a round now.
`;
