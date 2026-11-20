// Is a newer release out? At most once a day, one GET to GitHub's public releases API: no token, nothing
// about the person. The answer is kept in shared `scheduler.update` ({ checked, latest }), so every copy
// sees it and a restart doesn't ask again. Updating is an agent's job (prompt.js, `updatePrompt`).
// Pure: `shared` and `setShared` are handed in, so `node --test` runs it.

// The release this copy is. Bumped in the commit that gets the tag (AGENTS.md, Versions).
export const VERSION = "0.2.0";
export const REPO = "kimsuhan/herdr-scheduler";

/** a > b, for versions like v1.2.3 or 1.2.3. */
export function newer(a, b) {
  const parts = (v) => String(v).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** The release to offer ("v0.3.0") from the shared state, or null. */
export const available = (s) => (s?.latest && newer(s.latest, VERSION) ? s.latest : null);

/** Asks GitHub unless it was asked in the last day (an hour, after a failure). Never throws. */
export async function checkUpdate(shared, setShared, now = Date.now()) {
  const KEY = "scheduler.update", DAY = 86_400_000, HOUR = 3_600_000;
  const s = shared(KEY) ?? {};
  const since = now - (s.checked ?? 0);
  if (since >= 0 && since < DAY) return; // a time in the future (a wrong clock) counts as long ago
  setShared(KEY, { ...s, checked: now }); // before asking, so other copies starting now don't ask too
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "herdr-scheduler" },
    });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const tag = (await r.json())?.tag_name;
    // The tag goes into an agent's prompt: only a plain version is kept.
    if (/^v?\d+\.\d+\.\d+$/.test(tag ?? "") && tag !== s.latest) setShared(KEY, { checked: now, latest: tag });
  } catch {
    setShared(KEY, { ...s, checked: now - DAY + HOUR }); // offline, or a network not up yet after a wake
  }
}
