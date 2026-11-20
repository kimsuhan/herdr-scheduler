import test from "node:test";
import assert from "node:assert/strict";
import { VERSION, newer, available, checkUpdate } from "./update.js";
import { updatePrompt } from "./prompt.js";

const DAY = 86_400_000, HOUR = 3_600_000;

test("newer", () => {
  assert.ok(newer("v0.10.0", "0.9.2"));
  assert.ok(newer("1.0.0", "v0.9.9"));
  assert.ok(!newer("v0.2.0", "0.2.0"));
  assert.ok(!newer("0.1.9", "0.2.0"));
});

test("available: only a release newer than this copy", () => {
  assert.equal(available({ latest: "v99.0.0" }), "v99.0.0");
  assert.equal(available({ latest: `v${VERSION}` }), null);
  assert.equal(available({}), null);
  assert.equal(available(undefined), null);
});

// A fake shared state and GitHub: `answer` is what fetch resolves to, or throws when it is an Error.
function setup(state, answer) {
  const box = { state, asked: 0 };
  globalThis.fetch = async () => {
    box.asked++;
    if (answer instanceof Error) throw answer;
    return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
  };
  return [box, () => box.state, (_k, v) => { box.state = v; }];
}

test("checkUpdate", async () => {
  const now = 10 * DAY;
  let [box, get, set] = setup(undefined, { status: 200, body: { tag_name: "v9.0.0" } });
  await checkUpdate(get, set, now);
  assert.deepEqual(box.state, { checked: now, latest: "v9.0.0" });

  await checkUpdate(get, set, now + DAY - 1); // asked within a day
  assert.equal(box.asked, 1);

  [box, get, set] = setup({ checked: now - DAY, latest: "v1.0.0" }, { status: 200, body: { tag_name: "v1.0.0\nrm -rf ~" } });
  await checkUpdate(get, set, now);
  assert.deepEqual(box.state, { checked: now, latest: "v1.0.0" }); // a tag that isn't a version is not kept

  [box, get, set] = setup({ checked: 0 }, new Error("offline"));
  await checkUpdate(get, set, now);
  assert.deepEqual(box.state, { checked: now - DAY + HOUR }); // asked again in an hour

  [box, get, set] = setup({ checked: 0 }, { status: 403 });
  await checkUpdate(get, set, now);
  assert.deepEqual(box.state, { checked: now - DAY + HOUR });

  [box, get, set] = setup({ checked: now + DAY }, { status: 200, body: { tag_name: "v2.0.0" } });
  await checkUpdate(get, set, now); // a check stamped in the future
  assert.equal(box.state.latest, "v2.0.0");
});

test("updatePrompt keeps the person's schedules", () => {
  const p = updatePrompt("~/.config/herdr-app", "v9.0.0", "0.2.0", "Korean");
  assert.match(p, /from v0\.2\.0 to v9\.0\.0/);
  assert.match(p, /at tag v9\.0\.0/);
  assert.match(p, /Never delete, move or overwrite anything in ~\/\.config\/herdr-app\/mods\/herdr-scheduler\/jobs\//);
  assert.match(p, /Talk to me in Korean/);
});
