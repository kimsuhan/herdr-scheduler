// The panel's languages. English is the source: the text in the code is the key, and a language maps
// keys to its own text ({0}, {1} are filled in). Anything a language doesn't have stays English.
// Pure: no herdr or gpui-kit import, so `node --test` runs it.

export const LANGUAGES = [["en", "English"], ["ko", "한글"]];

const KO = {
  // The panel
  "Scheduler": "스케줄러", "Settings": "설정", "Language": "언어", "Add schedule": "스케줄 추가", "Add script": "스크립트 추가", "New script": "새 스크립트",
  "A script checks something on a schedule and reacts only to what is new.": "스크립트는 정해진 주기마다 무언가를 확인하고, 새로 생긴 일에만 반응합니다.",
  "Check": "확인", "on its schedule": "정해진 주기마다", "New only": "새 항목만", "each item once": "항목마다 한 번",
  "React": "반응", "an agent, or a note": "에이전트 또는 알림",
  "Have an agent write it": "에이전트에게 맡기기",
  "The prompt explains how scripts work and makes the agent ask you what to build.": "프롬프트가 스크립트의 동작 방식을 알려 주고, 무엇을 만들지는 에이전트가 되묻게 합니다.",
  "Start in a new tab": "새 탭에서 시작", "Copy prompt": "프롬프트 복사", "Copied": "복사됨", "Show prompt": "프롬프트 보기", "Hide prompt": "프롬프트 숨기기",
  "Change its code": "코드 수정하기",
  "The prompt points the agent at this script's file and makes it ask you what to change.": "프롬프트가 이 스크립트의 파일을 알려 주고, 무엇을 바꿀지는 에이전트가 되묻게 합니다.",
  "Write it by hand": "직접 만들기",
  "Copy the example into the jobs folder and edit it. Its comments explain the format, and saving the file adds it here.":
    "예제를 jobs 폴더로 복사해서 고치세요. 형식은 파일의 주석에 설명돼 있고, 저장하면 여기에 나타납니다.",
  "New schedule": "새 스케줄", "Edit {0}": "{0} 수정",
  "{0} schedule": "스케줄 {0}개", "{0} schedules": "스케줄 {0}개", "Loading…": "불러오는 중…", "No schedules yet.": "아직 스케줄이 없습니다.",
  "A schedule is one JS file. Press Add schedule to make one, or copy one from mods/herdr-scheduler/examples/ to mods/herdr-scheduler/jobs/ and edit it; it shows up here when saved.":
    "스케줄 하나는 JS 파일 하나입니다. 스케줄 추가를 눌러 만들거나, mods/herdr-scheduler/examples/의 파일을 mods/herdr-scheduler/jobs/로 복사해서 고치세요. 저장하면 여기에 나타납니다.",
  "Timeline": "타임라인", "now": "지금",
  "Running": "실행 중", "Needs attention": "확인 필요", "Schedules": "스케줄", "Scripts": "스크립트", "Paused": "일시 정지", "{0} item, {1} new": "항목 {0}개, 새 항목 {1}개",
  "{0} items, {1} new": "항목 {0}개, 새 항목 {1}개",
  // When
  "just now": "방금", "{0}m ago": "{0}분 전", "{0}h ago": "{0}시간 전",
  // What a schedule or a run is doing, what started it, where it runs
  "broken": "오류", "blocked": "대기 중", "running": "실행 중", "paused": "일시 정지", "failed": "실패", "missed": "놓침",
  "interrupted": "중단됨", "starting": "시작 중", "done": "완료", "ended": "종료됨", "handled": "처리됨", "skipped": "건너뜀",
  "schedule": "예약", "catch-up": "따라잡기", "manual": "수동", "poll": "확인",
  "background": "백그라운드", "space": "스페이스", "worktree": "워크트리",
  // A schedule's page
  "Run now": "지금 실행", "Pause": "일시 정지", "Resume": "재개", "Edit": "수정", "Delete": "삭제", "Really delete": "정말 삭제",
  "Schedule": "일정", "Next": "다음 실행", "Status": "상태", "On": "켜짐", "Where": "위치", "Agent": "에이전트", "Runs": "실행 내용", "Checked": "확인",
  "{0}, catches up within {1}m": "{0}, {1}분 안이면 따라잡음", "background, {0}": "백그라운드, {0}", "space {0}": "스페이스 {0}",
  "worktree {0} of {1}": "{1}의 워크트리 {0}", "code: poll, handle": "코드: poll, handle", "code: poll, handle, ended": "코드: poll, handle, ended",
  "not since the last reload": "다시 로드된 뒤 아직 없음", "History": "이력", "No runs yet.": "아직 실행 기록이 없습니다.",
  "This run's terminal is gone.": "이 실행의 터미널은 없어졌습니다.",
  // The form
  "Name": "이름", "About": "설명", "Repeat": "반복", "Daily": "매일", "Weekdays": "평일", "Days": "요일 선택", "Every": "간격",
  "Mo": "월", "Tu": "화", "We": "수", "Th": "목", "Fr": "금", "Sa": "토", "Su": "일",
  "Interval (5m, 2h, 1d)": "간격 (5m, 2h, 1d)", "Time (24h)": "시각 (24시간)", "Catch up a missed run within": "놓친 실행을 따라잡을 시간",
  "Folder": "폴더", "Run here": "여기서 실행", "Repository": "저장소", "This repository": "이 저장소", "Check out": "체크아웃",
  "Latest every run": "매번 최신 코드", "Keep a branch": "브랜치 유지", "Code to start from": "어떤 코드에서 시작할지",
  "Branch or commit to check out": "받아 올 브랜치 또는 커밋", "Branch name": "브랜치 이름",
  "No tab: the agent runs out of sight, and you read the run in this schedule's history.": "탭이 생기지 않습니다. 에이전트는 보이지 않는 곳에서 돌고, 실행 내용은 이 스케줄의 이력에서 봅니다.",
  "A new tab in the space you pick.": "고른 스페이스에 새 탭으로 뜹니다.",
  "A separate copy of the repository in its own space, so the agent never touches your working folder.": "저장소의 별도 사본을 만들어 그 스페이스에서 실행합니다. 지금 작업 중인 폴더는 건드리지 않습니다.",
  "Before every run it fetches and checks out what you name here, so each run starts from the newest code. Nothing is committed to it.":
    "실행할 때마다 여기 적은 것을 새로 받아 와서 시작합니다. 항상 최신 코드에서 출발하고, 이 사본에는 커밋이 쌓이지 않습니다.",
  "The branch is made once from the repository's current code, then left as the agent leaves it: its commits stay for the next run.":
    "브랜치를 처음 한 번만 만들고, 그 뒤로는 에이전트가 둔 상태 그대로 둡니다. 커밋이 다음 실행까지 남습니다.", "Background": "백그라운드", "Space": "스페이스", "Worktree": "워크트리",
  "Agent command": "에이전트 명령", "Prompt": "프롬프트", "Cancel": "취소", "Save": "저장", "Model": "모델", "default model": "기본 모델", "Edit the command": "명령 직접 수정", "What": "무엇을", "When": "언제", "Who and where": "누가 어디서",
  "next run in {0}": "다음 실행까지 {0}", "Reset to the file": "파일 값으로 되돌리기",
  "Changed in the panel: the file has other values.": "패널에서 변경됨: 파일의 값과 다릅니다.", "Choose…": "선택…",
  "none, or 2h": "없음, 또는 2h", "optional: what this schedule is for": "선택: 이 스케줄이 하는 일",
  "What the agent is told on every run": "실행할 때마다 에이전트에게 보낼 말",
  // Notifications
  "{0} didn't start": "{0} 시작 실패", "{0} failed": "{0} 실패", "{0} failed on {1}": "{0} 실패: {1}",
  // What is wrong with a schedule or a run
  "name is missing": "이름이 없습니다", "pick a space": "스페이스를 고르세요", "{0} is missing": "{0} 값이 없습니다",
  "schedule is missing": "schedule이 없습니다",
  "schedule needs every, daily, weekdays, or days with at": "schedule에는 every, daily, weekdays, 또는 days와 at이 필요합니다",
  "no default export": "default export가 없습니다", "about is a line of text": "about은 한 줄 글이어야 합니다",
  "a code schedule needs poll and handle functions": "코드 스케줄에는 poll과 handle 함수가 필요합니다",
  "ended must be a function": "ended는 함수여야 합니다",
  "where needs exactly one of background, space, worktree": "where에는 background, space, worktree 중 하나만 써야 합니다",
  "where.worktree needs repo": "where.worktree에는 repo가 필요합니다",
  'agent is a command, like ["claude", "--model", "haiku"]': 'agent는 ["claude", "--model", "haiku"] 같은 명령이어야 합니다',
  "prompt is missing": "prompt가 없습니다", "a name can't have / \\ : = in it or start with a dot": "이름에는 / \\ : = 를 쓸 수 없고, 점으로 시작할 수 없습니다",
  "the agent asked something before taking the prompt (a trust or permission dialog)": "에이전트가 프롬프트를 받기 전에 무언가를 물었습니다 (신뢰 또는 권한 확인 창)",
  "the agent exited before taking the prompt": "에이전트가 프롬프트를 받기 전에 종료됐습니다",
  "the agent wasn't ready after 2 minutes": "에이전트가 2분 안에 준비되지 않았습니다",
  "the agent asks whether to trust its folder: trust it once by hand, or give the run a cwd it trusts": "에이전트가 폴더를 신뢰할지 묻고 있습니다: 그 폴더에서 한 번 직접 신뢰하거나, 이미 신뢰하는 폴더를 cwd로 지정하세요",
  "poll must return an array of items": "poll은 항목 배열을 돌려줘야 합니다",
  "every item poll returns needs a key": "poll이 돌려주는 모든 항목에는 key가 필요합니다",
};

// Messages with a value inside, which can't be keys: English pattern, then the text ($1 is the value).
const KO_PATTERNS = [
  [/^"(.*)" is not a duration \(5m, 2h, 1d\)$/, "올바른 기간이 아닙니다: $1 (예: 5m, 2h, 1d)"],
  [/^"(.*)" is not a time \(09:30\)$/, "올바른 시각이 아닙니다: $1 (예: 09:30)"],
  [/^a schedule named (.*) is already there$/, "$1 스케줄이 이미 있습니다"],
  [/^the prompt wasn't sent: (.*)$/s, "프롬프트를 보내지 못했습니다: $1"],
  [/^no space "(.*)" on this machine$/, "이 컴퓨터에 $1 스페이스가 없습니다"],
  [/^ctx\.(\w+) works in handle only$/, "ctx.$1 호출은 handle 안에서만 됩니다"],
  // A schedule as schedule.js describes it
  [/^every (\d+)m$/, "$1분마다"], [/^every (\d+)h$/, "$1시간마다"], [/^every (\d+)d$/, "$1일마다"],
  [/^daily (\d\d:\d\d)$/, "매일 $1"], [/^weekdays (\d\d:\d\d)$/, "평일 $1"],
];
const KO_DAYS = { Sun: "일", Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토" };

const TEXTS = { ko: [KO, KO_PATTERNS] };

// `key` in `lang`, with {0}, {1}... filled from `args`. Also takes a finished English message (an
// error, a described schedule) and gives it back translated when the language knows it.
export function say(lang, key, ...args) {
  const [texts, patterns] = TEXTS[lang] ?? [{}, []];
  let text = texts[key];
  if (text == null) {
    const hit = patterns.find(([re]) => re.test(key));
    text = hit ? key.replace(hit[0], hit[1]) : key;
    // "Mon, Wed 18:30": chosen days, which schedule.js names in English.
    if (!hit && lang === "ko" && /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(, (Sun|Mon|Tue|Wed|Thu|Fri|Sat))* \d\d:\d\d$/.test(key))
      text = key.replace(/[A-Z][a-z]{2}/g, (d) => KO_DAYS[d]);
  }
  return text.replace(/\{(\d+)\}/g, (_m, i) => args[i]);
}

// The keys a language has, for the test that checks the code's keys against it.
export const keys = (lang) => Object.keys(TEXTS[lang]?.[0] ?? {});
