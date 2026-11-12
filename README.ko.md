# herdr-scheduler

[Herdr](https://herdr.dev) 앱 안에서 코딩 에이전트에게 예약된 프롬프트를 보냅니다. mod 하나, 스케줄 하나에 JS 파일
하나입니다. 데몬, cron 등록, CLI가 없습니다.

[English](README.md)

![Scheduler](app/preview.png)

스케줄은 정해진 일정에 에이전트에게 프롬프트를 보냅니다. 실행 위치는 세 가지입니다.

- **background**: 탭이 생기지 않습니다. 실행 내용은 패널의 이력에서 봅니다.
- **space**: 지정한 스페이스에 새 탭으로 뜹니다.
- **worktree**: git 워크트리 위의 스페이스에서 실행합니다. 실행할 때마다 fetch하고 checkout합니다.

스케줄이 시작해도 창의 포커스는 옮겨 가지 않습니다.

## 데몬과 다른 점

mod가 곧 스케줄러라서, 스케줄은 **Herdr가 켜져 있고** Scheduler 패널이 지금 레이아웃에 있을 때만 실행됩니다. 패널이
항상 보이는 자리가 아니라면(예: 스택의 한 탭) 스케줄만 돌리는 headless 사본을 하나 더 두세요. 레이아웃에 넣을
한 줄은 [app/RECIPE.md](app/RECIPE.md)에 있습니다. Herdr가 꺼져 있어 놓친 실행은 스케줄에 `catchUp`을 정해 두면 켰을 때 따라잡습니다. 앱을 닫은
동안에도 실행해야 한다면 [herdr-automations](https://github.com/DnzzL/herdr-automations) 같은 데몬을 쓰세요.

## 설치

Herdr에서 에이전트에게 이렇게 시킵니다.

```
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/kimsuhan/herdr-scheduler/tree/main/app
```

직접 하려면:

```sh
git clone https://github.com/kimsuhan/herdr-scheduler
cp -R herdr-scheduler/app/mods/herdr-scheduler ~/.config/herdr-app/mods/
```

Herdr가 이 mod를 처음 보면 패널을 오른쪽에 붙입니다. `hc`(herdr-core)가 필요하고, 워크트리 스케줄은 `git`도
필요합니다.

## 스케줄

패널 맨 아래 Add schedule을 눌러 폼을 채우거나, mod 폴더 안의 `examples/daily-prompt.js`를 `jobs/<이름>.js`로 복사해서
고칩니다. 어느 쪽이든 스케줄은 그 파일 하나이고, 파일 이름이 스케줄 이름입니다.

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

| 필드 | 값 |
|---|---|
| `schedule` | `{ daily: "09:00" }`, `{ weekdays: "09:00" }`, `{ days: [1, 3], at: "09:00" }`(0이 일요일), `{ every: "30m" }`(`m`, `h`, `d`) |
| `about` | 선택: 패널의 스케줄 화면에 보여 줄 설명 한 줄 |
| `catchUp` | 선택, `"2h"`: 이 시간 안에 놓친 실행은 그래도 실행합니다. 없으면 놓친 실행은 놓친 채로 둡니다 |
| `where` | `{ background: true, cwd }`, `{ space: "<이름 또는 id>" }`, `{ worktree: { repo, commit } }` 또는 `{ worktree: { repo, branch } }` |
| `agent` | 실행할 명령, 배열로 |
| `prompt` | 에이전트가 준비되면 보내는 말 |

워크트리는 Herdr 기본 worktree mod와 같은 `~/.herdr/worktrees/<repo>/<스케줄 이름>`에 만듭니다. `commit`(예:
`origin/main`)은 실행할 때마다 fetch해서 detached로 checkout하고, `branch`는 처음 한 번 만든 뒤 에이전트가
둔 상태 그대로 둡니다.

스케줄은 사용자가 넣는 코드이고, 내 컴퓨터에서 프로그램을 프롬프트와 함께 실행합니다. 남이 만든 스케줄은 넣기 전에
읽어 보세요.

## 코드 스케줄

스케줄은 프롬프트 대신 코드를 실행할 수도 있습니다. 일정마다 항목을 조회(poll)하고 새 항목마다 처리(handle)합니다.
`examples/worktree-cleanup.js`(PR이 병합되거나 닫힌 워크트리 스페이스를 표시합니다)를 복사하고 주석을 읽어
보세요. 형식과 `ctx`가 모두 설명되어 있습니다.

```js
export default {
  schedule: { every: "5m" },
  async poll(ctx) { return [{ key: "pr-12@merged", thread: "pr-12" }]; }, // 항목. key마다 한 번만 처리
  async handle(item, ctx) {
    const t = ctx.thread(item.thread);            // 그 스레드를 맡은 터미널, 없으면 null
    if (t) return ctx.send(t, "It was merged. Wrap up.");
    await ctx.start({ where: { background: true, cwd: "~/code/my-app" }, agent: ["claude"], prompt: "…", thread: item.thread });
  },
  async ended(thread, ctx) { return false; },     // 선택: true면 스레드 터미널을 놓아 줌
};
```

`ctx`에는 `exec`, `start`, `send`, `thread`, `notify`, `skip`, `state.get`/`state.set`(Herdr 공유 상태의
`scheduler.state`에 저장), `spaces`, `panes`, `terminals`, `home`이 있습니다. 에이전트를 띄우는 스케줄은 항목을
한 번에 하나씩 처리하고, 나머지는 다음 회차에 처리합니다. 코드 스케줄은 내 컴퓨터에서 어떤 코드든, 어떤 프로그램이든
실행하므로 넣기 전에 읽어 보세요. 폼은 프롬프트 스케줄만 다룹니다.

## 패널

영어와 한국어를 지원합니다. 패널 맨 아래 Settings에서 고릅니다.

- 스케줄마다 일정, 다음 실행, 지금 상태를 보여 줍니다. `▶`는 지금 실행입니다.
- Add schedule으로 스케줄을 만듭니다. 스케줄을 누르면 Run now, Pause, Edit, Delete, 설정, 이력이 나옵니다.
- 이력 행을 누르면 백그라운드 실행은 peek으로 열리고, 탭에서 도는 실행은 그 pane으로 이동하고, 끝난 실행은
  마지막 화면을 패널에 보여 줍니다.
- 파일이 깨진 스케줄은 오류를 보여 주고 실행하지 않습니다. 다른 스케줄은 그대로 돕니다.

스케줄은 지난 실행이 아직 일하는 중이거나 사용자를 기다리는 동안에는 새로 시작하지 않습니다. 백그라운드 실행을
시작할 때 그 스케줄의 이전 백그라운드 에이전트 중 쉬고 있는 것은 종료하므로 쌓이지 않습니다.

## 제거

`~/.config/herdr-app/mods/herdr-scheduler` 폴더(내 스케줄은 그 안의 `jobs/`에 있습니다)와 레이아웃의 블록을 지웁니다.

## 개발

[AGENTS.md](AGENTS.md)를 보세요. mod 전체 설명은 [app/RECIPE.md](app/RECIPE.md)에 있습니다.

## 라이선스

MIT
