// A bot: copy this file to ../jobs/<name>.js and edit it. The file name is the bot's name.
// Saving it reloads the scheduler; a mistake shows in the panel instead of running.

export default {
  // Optional: a line the panel shows on the bot's page.
  about: "Checks dependencies for known vulnerabilities every weekday morning.",

  // When. One of:
  //   { daily: "09:00" }              every day
  //   { weekdays: "09:00" }           Monday to Friday
  //   { days: [1, 3], at: "09:00" }   chosen days, 0 = Sunday
  //   { every: "30m" }                every 5m, 2h, 1d... (counted from the hour, not from now)
  schedule: { weekdays: "09:00" },

  // Optional. Herdr was closed at 09:00: still run if it opens within this long. Without it a
  // missed run stays missed.
  catchUp: "2h",

  // Where. One of:
  //   { background: true, cwd: "~/code/my-repo" }      no tab: read it from the panel's history
  //   { space: "my-repo" }                             a new tab in that space (its name or id)
  //   { worktree: { repo: "~/code/my-repo", commit: "origin/main" } }
  //       a space on ~/.herdr/worktrees/my-repo/<bot name>, fetched and checked out on every run.
  //       `branch: "nightly"` instead of commit keeps a branch; `name` picks another folder name.
  where: { background: true, cwd: "~/code/my-repo" },

  // The agent's command, and what it is told once it is ready.
  agent: ["claude", "--model", "haiku"],
  prompt: "Check this repo's dependencies for known vulnerabilities and summarize what needs an upgrade.",
};
