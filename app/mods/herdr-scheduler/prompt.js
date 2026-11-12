// The prompt the panel hands an agent to write a script (a code schedule) with the person. It says how
// scripts work and where things are, and makes the agent ask what to build: the panel can't know that.
// Pure: no herdr or gpui-kit import. `dir`: the mod's folder. `language`: what the agent talks in.
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
- It default-exports { about, schedule, async poll(ctx), async handle(item, ctx), async ended(thread, ctx) }. ended is optional; about is one line saying what it does.
- At each scheduled time, poll returns items [{ key, ...data }], and handle runs once for each key never seen before. Put into the key whatever should make an item count as new again.
- It may use only ctx: exec, start, send, thread, notify, skip, state, spaces, panes, terminals, home. No imports, no setTimeout, no top-level await, nothing kept between rounds except through ctx.state.
- Values that are mine (repo paths, names, prompts) go in constants at the top of the file.
- A script must not delete, push, post, merge or pay on its own. If what I ask needs one of those, ask me first and say so in its about line.

When the file is written:
- Run "herdr-app check ${dir}" and "herdr-app status"; the errors list must be empty.
- Tell me the script's name, how often it runs, and exactly what its first round will do. Nothing runs before its next scheduled time; I can press the play button on its row in the panel to run a round now.
`;
