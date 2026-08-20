// 사무실을 살아 있게 하는 쪽 — 백엔드에서 상태를 받아 오고, 사람을 걷게 한다.
//
// 그리는 일은 `office.js` 가 맡는다. 여기서는 **누가 어디 있고 무슨 자세인지**만 정한다.
//
// 데이터는 두 갈래로 들어온다. 스냅샷(`/v1/console/snapshot`)이 지금 상태 전부를 주고,
// 실시간 스트림(`/v1/console/stream`)이 그 뒤의 변화를 알린다. 스트림만 쓰면 화면을 열기
// 전에 일어난 일을 모르고, 스냅샷만 쓰면 폴링 간격만큼 늦는다.

import {
  OfficeRenderer,
  preloadSprites,
  characterSpriteFor,
} from "./office.js";

/** 유휴 산책 규칙 — 맥 앱 `OfficeIdle` 과 같은 값. */
const STROLL_TICK_SECONDS = 8;
const STROLL_COOLDOWN_SECONDS = 90;
/**
 * 동시 배회 인원 — 맥 쪽 `officeStrollDefaultConcurrency` 와 같은 값.
 *
 * 2 였다. 서른두 명 중 둘(6%)만 움직여 사무실이 멈춘 것처럼 보였고, 그 둘이 가는 곳조차
 * 하는 일과 무관했다. 목적지가 일과 이어진 뒤에는(`affinitySpot`) 걷는 사람이 늘어도
 * 산만해지지 않는다 — 각자 자기 물건 쪽으로 가므로 동선이 방 안에서 끝난다.
 */
const STROLL_CONCURRENCY = 3;
/** 한 칸 걷는 데 걸리는 시간(초). 0.16 은 다리가 교차하기 전에 몸이 지나가 종종거려 보였다. */
const STEP_SECONDS = 0.2;
/** 스냅샷을 다시 받는 주기(초). 스트림이 끊겨도 화면이 굳지 않게 하는 안전망이다. */
const SNAPSHOT_INTERVAL_SECONDS = 20;
/** 출퇴근 걷기를 한 사람씩 늦추는 간격(초) — 맥 앱 `arrivalStagger` 와 같은 값. */
const COMMUTE_STAGGER_SECONDS = 0.12;
/**
 * 출근 판정을 다시 훑는 주기(초).
 *
 * 시각 경계는 **이벤트를 내지 않는다** — 9시가 되는 순간 백엔드에서 오는 것은 아무것도 없다.
 * 시간축으로 한 번씩 훑지 않으면 아무도 출근하지 않고, 다음 무관한 이벤트가 올 때까지 새벽
 * 화면이 그대로 남는다.
 */
const ATTENDANCE_TICK_SECONDS = 60;
/** 방치 압력을 다시 따지는 주기(초) — 맥 앱 `officeApprovalPressureSweepIntervalSeconds`. */
const PRESSURE_SWEEP_SECONDS = 30;
/**
 * 방치 단계가 올라가는 TTL 소진 비율 — 맥 앱 `officeApprovalPressureThresholds`.
 *
 * 절대 경과 시간이 아니라 비율인 이유는 카드마다 TTL 이 다르기 때문이다. "두 시간 지나면
 * 경고등" 으로 못 박으면 TTL 한 시간짜리 카드는 이미 만료된 뒤에 신호가 나온다.
 */
const PRESSURE_THRESHOLDS = { holdingPapers: 0.25, tapping: 0.5, alarm: 0.8 };
/**
 * 점심시간에 목적지가 기우는 가구 — 맥 앱 `officeStrollSpot` 의 탕비실·회의실 목록과 같다.
 *
 * 이 목록이 맥과 어긋나면 정오 화면에서 두 사무실의 사람이 다른 방에 모인다.
 */
const LUNCH_KINDS = new Set([
  "sofa2",
  "sofa3",
  "coffeeTable",
  "coffeeMachine",
  "waterCooler",
  "vendingMachine",
  "refrigerator",
  "sinkCounter",
  "meetingTable",
]);

const status = document.getElementById("status");
const canvas = document.getElementById("office");

/**
 * 회귀 렌더 모드 — 맥 앱의 `--render` 에 해당한다.
 *
 *     ?static=1&hour=12
 *
 * 실시간 스트림을 열지 않고 한 판만 그리고 멈춘다. 스트림을 연 채로는 페이지가 "다 실렸다"
 * 에 도달하지 않아 **화면 캡처 도구가 영영 기다린다** — 시각 확인을 사람이 앱을 띄우는
 * 것에만 맡기지 않으려면 이 입구가 필요하다. `hour` 는 창밖 빛을 고정해 두 화면을 같은
 * 시간대에서 대조하게 한다(안 주면 지금 시각).
 */
const query = new URLSearchParams(window.location.search);
const isStatic = query.get("static") === "1";
const fixedHour = query.has("hour") ? Number(query.get("hour")) : null;
/**
 * `?walk=3` — 정지 렌더에서 산책을 강제로 일으키고 그 초만큼 진행시킨 뒤 그린다.
 *
 * 걷기는 시간이 지나야 나타나므로 정지 화면에는 절대 잡히지 않는다. 확인 수단이 "사람이
 * 브라우저를 열어 8초를 기다린다" 하나뿐이면 걸음 그림이 빠져도 아무도 모른다.
 */
const walkSeconds = query.has("walk") ? Number(query.get("walk")) : 0;
/**
 * `?pressure=3` — 승인 카드 하나를 그 단계까지 방치된 것으로 꾸며 넣는다.
 *
 * 실 백엔드는 승인 대기가 0건인 날이 대부분이라, 이 입구가 없으면 줄서기·서류·발 구르기·
 * 대표 경고등이 **한 번도 화면에 뜨지 않는다**(맥 앱의 `--alarm-demo` 와 같은 자리).
 * 맥과 달리 가짜 사람을 만들지 않고 평면도의 첫 좌석 주인에게 붙인다 — 자리가 있어야
 * 줄로 걸어 나가는 것까지 대조할 수 있다.
 */
const pressureDemo = query.has("pressure") ? Number(query.get("pressure")) : 0;
/**
 * `?queue=12` — 방치 데모 카드를 그 인원수만큼 만든다.
 *
 * 대표실 앞 자리는 열 칸 남짓이라, 그보다 긴 줄에서만 드러나는 어긋남(자리를 못 받은 사람이
 * 줄 명단에는 있는데 몸은 책상에 앉아 있는 상태)이 있다. 기본 한 명으로는 그 구간에 닿지 않는다.
 */
const queueDemo = query.has("queue") ? Number(query.get("queue")) : 1;
/**
 * `?commute=4` — 출근(또는 퇴근) 걷기를 일으키고 그 초만큼 진행시킨 뒤 그린다.
 *
 * 출퇴근은 **시각 경계를 넘는 순간에만** 일어나는데 정지 렌더는 시각이 고정이라 그 순간이
 * 영영 오지 않는다. 지금 시각이 근무 시간이면 출근을, 아니면 퇴근을 그린다.
 */
const commuteSeconds = query.has("commute") ? Number(query.get("commute")) : 0;

/** 지금 화면에 놓인 사람들. agentType → 위치·자세. */
const bodies = {};
/** agentType → 백엔드가 준 상태(색·말풍선·오늘 처리량). */
let agents = {};
let sessions = [];
let renderer = null;
let layouts = {};
let zoneColumns = 3;
/** 마지막으로 산책을 나간 시각(초). 같은 사람이 연달아 나가지 않게 한다. */
const lastStrollAt = {};
const strolling = new Set();
let lastTickAt = 0;
/** 백엔드가 준 승인 카드. 줄 세우기와 방치 압력의 입력이다. */
let approvals = [];
/** 대표실 앞에 선 순서. 먼저 기다린 사람이 앞에 남는다. */
let queueOrder = [];
/** 출퇴근으로 걷는 중인 사람. 배회 감독관이 이들을 새로 뽑으면 걸음이 서로를 취소한다. */
const commuting = new Set();
/** 퇴근 걷기를 이미 시작한 사람. 두 번 걸면 문 앞에서 걸음이 겹친다. */
const departing = new Set();
/** 출근 판정을 마지막으로 적용한 시(0~23). 이 값이 바뀔 때만 걷기 연출을 튼다. */
let lastAttendanceHour = null;
let lastAttendanceTickAt = 0;
let lastPressureSweepAt = 0;
/** 가장 급한 승인이 만료 임박(4단계)인가. 대표 머리 위 경고등이 이 값을 본다. */
let presidentAlarm = false;
/** 실제로 받아 둔 그림 장수. 상태 줄에 찍어 에셋 누락이 조용히 지나가지 않게 한다. */
let loadedSpriteCount = 0;
/**
 * 평면도에 자리가 없는 사람들.
 *
 * 평면도는 **뽑은 시점의 사진**이라(데스크톱 앱은 빌드에 동봉한다) 백엔드에 사람이 늘면
 * 그 사람은 좌석을 못 찾는다. 그때 `sendHome` 이 그 사람을 화면에서 지우므로 **오류 없이
 * 조용히 사라진다** — 여기 모아 상태 줄에 찍어 "평면도를 다시 뽑아야 한다" 를 드러낸다.
 */
let agentsWithoutSeat = [];

// MARK: - 평면도

/**
 * 창 비율에 따라 3열(가로형)·2열(세로형) 배치 중 하나를 고른다.
 *
 * 타일 한 칸은 `min(너비 / 열, 높이 / 줄)` 이라 **창 비율에 따라 병목이 가로에서 세로로
 * 옮겨 간다.** 세로로 긴 창에서 3열을 쓰면 좌우가 남고 위아래가 눌려 절반을 버린다.
 *
 * 두 배치를 오갈 때 5% 이득이 있어야 바꾸는 이유는 **경계에서 떨리기 때문**이다 —
 * 창을 조금만 끌어도 배치가 왕복하면 사무실이 통째로 다시 그려진다.
 */
function chooseZoneColumns(width, height, current) {
  const sizeFor = (columns) => {
    const plan = layouts[columns].plan;
    return Math.min(width / plan.columns, height / plan.rows);
  };
  if (!current) {
    return sizeFor(2) > sizeFor(3) ? 2 : 3;
  }
  const candidate = current === 2 ? 3 : 2;
  return sizeFor(candidate) >= sizeFor(current) * 1.05 ? candidate : current;
}

function resize() {
  const width = Math.max(320, window.innerWidth - 24);
  const height = Math.max(240, window.innerHeight - 52);
  // **캔버스 크기를 대입하면 그려 둔 그림이 지워진다 — 같은 값을 다시 넣어도 그렇다.**
  // 움직이는 화면은 다음 프레임이 다시 채우지만 정지 렌더는 한 번만 그리므로, 창 크기가
  // 뒤늦게 확정되면(캡처 도구가 그렇다) 화면이 통째로 빈 채 남는다 — 오류도 없이 텅 빈
  // 사무실이 저장됐다. 값이 실제로 달라졌을 때만 대입해 그 경로를 아예 없앤다.
  const nextWidth = Math.round(width);
  const nextHeight = Math.round(height);
  const sizeChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;
  const next = chooseZoneColumns(width, height, zoneColumns);
  const layoutChanged = next !== zoneColumns;
  zoneColumns = next;
  if (sizeChanged) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  if (layoutChanged || !renderer) {
    renderer = renderer ?? new OfficeRenderer(canvas, layouts[zoneColumns]);
    renderer.setLayout(layouts[zoneColumns]);
    // 배치가 통째로 바뀌었으므로 걷던 사람도 자기 새 자리로 돌려보낸다 — 옛 좌표에 남으면
    // 방 한가운데 떠 있게 된다.
    for (const agentType of Object.keys(bodies)) {
      sendHome(agentType);
    }
  } else if (sizeChanged) {
    renderer.measure();
  }
  if (isStatic && (sizeChanged || layoutChanged) && loadedSpriteCount > 0) {
    renderOnce();
  }
}

/** 한 판 그린다. 정지 렌더 모드와 창 크기 변경이 같은 경로를 쓴다. */
function renderOnce() {
  renderer.draw({
    agents,
    bodies,
    sessions,
    hour: currentHour(),
    blink: 1,
    // 정지 렌더는 시각을 고정한다 — 발 구르기·경고등이 매번 다른 위상에서 잡히면 두 번 그린
    // 그림이 서로 달라 회귀 비교가 성립하지 않는다. 3단계 이상을 보려 할 때만 발이 가장 높이
    // 오른 순간(0.22초)에 세운다. 0 으로 두면 발 구르기가 정확히 바닥이라 2단계와 구별되지 않아,
    // 그 표현이 통째로 빠져도 그림으로는 알 수 없다.
    now: pressureDemo >= 3 ? 0.22 : 0,
    presidentAlarm,
    summary: summaryCounts(),
  });
  setStatus(summary(), hasStaleLayout());
  document.body.dataset.rendered = "1";
}

// MARK: - 사람 배치

function seatOf(agentType) {
  return renderer.seatsByAgent.get(agentType) ?? null;
}

function sendHome(agentType) {
  const seat = seatOf(agentType);
  if (!seat) {
    delete bodies[agentType];
    return;
  }
  bodies[agentType] = {
    x: seat.x,
    y: seat.y,
    seated: true,
    facing: "down",
    pose: "sit",
    path: null,
  };
  strolling.delete(agentType);
}

/**
 * 화면에서 사람을 치운다 — 퇴근했거나 평면도에서 사라진 경우.
 *
 * 부기를 함께 지운다. 남겨 두면 다음 판정이 **이미 나간 사람**을 여전히 걷는 중이거나 줄에
 * 서 있는 것으로 읽어, 그 사람이 다시 출근할 때 연출을 통째로 건너뛴다.
 */
function despawn(agentType) {
  delete bodies[agentType];
  strolling.delete(agentType);
  commuting.delete(agentType);
  departing.delete(agentType);
}

// MARK: - 출퇴근

/** 지금 화면이 보는 시각. 정지 렌더는 `?hour=` 로 고정한다. */
function currentHour() {
  return fixedHour ?? new Date().getHours();
}

/**
 * 이 사람이 지금 사무실에 있어야 하는가 — 맥 앱 `officeAttendance` 와 **같은 순서**로 판정한다.
 *
 * 경계 시각(조기 출근·출근·퇴근)은 평면도가 싣고 온다. 여기 숫자를 다시 적으면 두 화면의
 * 인구가 새벽 5시·밤 9시처럼 사람이 눈치채기 어려운 시각에서만 갈린다.
 *
 * 걷는 중·들어오는 중 같은 과도 상태는 여기 두지 않는다. 그건 연출의 몫이고 이 판정은
 * "있어야 하는가/없어야 하는가" 두 값만 답한다.
 */
function attendanceOf(agentType) {
  // 1. 줄이 최우선. 줄 선 사람을 치우면 대기열이 실제 상태와 어긋난다.
  if (queueOrder.includes(agentType)) {
    return "present";
  }
  // 2. 일하는 사람은 시각과 무관하게 자리에 있다.
  if (agents[agentType]?.state === "IN_PROGRESS") {
    return "present";
  }
  const hours = renderer.layout.attendanceHours;
  const hour = ((Math.floor(currentHour()) % 24) + 24) % 24;
  // 3. 정규 근무.
  if (hour >= hours.arrival && hour < hours.departure) {
    return "present";
  }
  // 4. 조기 출근자. 밤 시간대에는 이 규칙을 적용하지 않으므로, 자정에 0 으로 리셋되는
  //    `doneToday` 가 야근하다 자정을 넘긴 사람의 판정을 뒤집지 못한다.
  if (
    hour >= hours.earlyBirdStart &&
    hour < hours.arrival &&
    (agents[agentType]?.doneToday ?? 0) > 0
  ) {
    return "present";
  }
  return "away";
}

/**
 * 시각과 실행 상태대로 사람을 놓고 치운다.
 *
 * `animated` 는 시각 경계를 실제로 넘었을 때만 참이다 — 스냅샷이 올 때마다 걷게 하면
 * 20초마다 사무실 전원이 문에서 다시 들어온다.
 *
 * 순서는 평면도의 좌석 순서를 그대로 쓴다. 회차마다 같은 사람이 같은 순번으로 들어와야
 * 두 화면을 같은 시각에서 대조할 수 있다.
 */
function applyAttendance(animated) {
  let arrivalIndex = 0;
  let departureIndex = 0;
  for (const entry of renderer.plan.desks) {
    if (!agents[entry.agentType]) {
      continue;
    }
    const present = attendanceOf(entry.agentType) === "present";
    if (present && !bodies[entry.agentType]) {
      if (animated) {
        playArrival(entry, arrivalIndex * COMMUTE_STAGGER_SECONDS);
        arrivalIndex += 1;
      } else {
        sendHome(entry.agentType);
      }
    } else if (!present && bodies[entry.agentType]) {
      // 이미 퇴근 걷는 중이면 건드리지 않는다. 스냅샷은 20초마다, 이벤트가 오면 그보다 자주
      // 도는데 퇴근 걸음은 그보다 짧다 — 여기서 지우면 복도를 걷던 사람이 문 앞에서 갑자기
      // 사라진다. 문에 닿는 순간 `playDeparture` 의 도착 콜백이 치운다.
      if (departing.has(entry.agentType)) {
        continue;
      }
      if (animated) {
        playDeparture(entry, departureIndex * COMMUTE_STAGGER_SECONDS);
        departureIndex += 1;
      } else {
        despawn(entry.agentType);
      }
    }
  }
}

/**
 * 출근 — 복도 진입점에 서서 기다렸다가 자기 자리까지 걸어온다.
 *
 * 서른 명이 한꺼번에 길을 찾으면 그 순간만 화면이 튄다. 사람마다 조금씩 늦춰 출발시킨다
 * (동시 상한을 두는 대신 계단식 지연 — 전원이 4초 안에 들어온다).
 */
function playArrival(entry, delay) {
  if (bodies[entry.agentType]) {
    return;
  }
  const entrance = renderer.plan.entranceTile;
  bodies[entry.agentType] = {
    x: entrance.x,
    y: entrance.y,
    seated: false,
    facing: "up",
    pose: "up",
    path: null,
    // 지연이 끝나기 전에는 그리지 않는다 — 문 앞에 전원이 겹쳐 선 그림이 먼저 뜬다.
    hidden: true,
    // 0 이면 지연 처리 자체를 건너뛰어 첫 사람이 영영 출발하지 않는다.
    delayRemaining: Math.max(delay, 1e-6),
  };
  // 지연 동안에도 배회 감독관(8초 주기)이 이 사람을 한가한 사람으로 뽑지 않게 미리 표시한다.
  commuting.add(entry.agentType);
  bodies[entry.agentType].onDelayEnd = () => {
    const body = bodies[entry.agentType];
    if (!body) {
      return;
    }
    body.hidden = false;
    // **줄이 출근을 이긴다.** 지연 중에 승인 대기줄에 들어갔다면 `reconcileQueue` 가 이미
    // 줄로 걷게 했다 — 여기서 좌석으로 다시 걸면 그 걸음을 빼앗아 줄이 실제 위치와 어긋난다.
    if (queueOrder.includes(entry.agentType)) {
      commuting.delete(entry.agentType);
      return;
    }
    const settle = () => {
      sendHome(entry.agentType);
      commuting.delete(entry.agentType);
    };
    if (!walkTo(entry.agentType, entry.seat, { onArrive: settle })) {
      settle();
    }
  };
}

/**
 * 퇴근 — 자리에서 복도 진입점까지 걸어간 뒤 화면에서 빠진다.
 *
 * 두 지점에서 상태를 다시 본다(지연이 끝날 때, 문에 닿을 때). 퇴근 시간대에도 새 일감이
 * 들어오는데, 한 번만 보면 이미 일을 시작한 사람이 그대로 걸어 나가 버린다.
 */
function playDeparture(entry, delay) {
  if (!bodies[entry.agentType] || departing.has(entry.agentType)) {
    return;
  }
  departing.add(entry.agentType);
  commuting.add(entry.agentType);
  strolling.delete(entry.agentType);
  const cancelled = () =>
    queueOrder.includes(entry.agentType) ||
    agents[entry.agentType]?.state === "IN_PROGRESS";
  bodies[entry.agentType].delayRemaining = Math.max(delay, 1e-6);
  bodies[entry.agentType].onDelayEnd = () => {
    const done = () => {
      departing.delete(entry.agentType);
      commuting.delete(entry.agentType);
    };
    if (!bodies[entry.agentType]) {
      done();
      return;
    }
    if (cancelled()) {
      // 나가는 걸 접고 자리로 돌아간다 — 줄이면 `reconcileQueue` 가 줄로 데려간다.
      if (!queueOrder.includes(entry.agentType)) {
        sendHome(entry.agentType);
      }
      done();
      return;
    }
    const leave = () => {
      // 문 앞에 닿는 사이 일이 들어왔을 수 있다. 그러면 나가지 않고 자리로 돌려보낸다.
      if (cancelled()) {
        sendHome(entry.agentType);
      } else {
        despawn(entry.agentType);
      }
      done();
    };
    if (!walkTo(entry.agentType, renderer.plan.entranceTile, { onArrive: leave })) {
      leave();
    }
  };
}

// MARK: - 승인 대기줄

/**
 * 승인 대기줄을 실제 승인 목록과 맞춘다 — 맥 앱 `reconciledQueueOrder` 와 같은 규칙.
 *
 * 이미 서 있던 순서를 보존하고 새로 대기가 된 사람만 뒤에 붙인다. 폴링마다 다시 세우면
 * 누가 먼저 기다렸는지가 화면에서 사라진다.
 *
 * 상태(`AWAITING_APPROVAL`)와 승인 카드 둘 중 **하나만 걸려도** 줄로 본다. 백엔드가 카드를
 * 먼저 만들고 상태를 한 박자 뒤에 반영하는 경로가 있어, 상태만 보면 카드가 떠 있는데도
 * 아무도 줄을 서지 않는 구간이 생긴다.
 */
function reconcileQueue() {
  const carded = new Set(
    approvals.map((approval) => approval.agentType).filter(Boolean)
  );
  const awaits = (agentType) =>
    agents[agentType]?.state === "AWAITING_APPROVAL" || carded.has(agentType);
  const next = queueOrder.filter(
    (agentType) => agents[agentType] && awaits(agentType)
  );
  for (const agentType of Object.keys(agents)) {
    if (awaits(agentType) && !next.includes(agentType)) {
      next.push(agentType);
    }
  }
  const left = queueOrder.filter((agentType) => !next.includes(agentType));
  queueOrder = next;
  return left;
}

/**
 * 줄 순서대로 대표실 앞자리에 세운다.
 *
 * **순서 갱신과 따로 두는 이유**: 출근 판정이 `queueOrder` 를 보고 사람을 놓기 때문에
 * 순서가 먼저 정해져야 한다. 그런데 그 시점엔 아직 몸이 없어 걷기를 걸 대상이 없다 —
 * 한 함수로 묶으면 사무실이 처음 채워지는 회차에서 줄서기가 통째로 빠진다.
 */
function settleQueue(left) {
  const tiles = renderer.plan.queueTiles ?? [];
  queueOrder.forEach((agentType, order) => {
    // 줄이 자리보다 길면 마지막 칸에 겹쳐 세운다(대기 인원이 많다는 것 자체가 신호) —
    // 맥 앱 `layoutQueue` 와 같은 폴백이다. 없으면 초과 인원이 `queueOrder` 에는 남아 출근
    // 판정과 배회 제외에는 대기자로 잡히면서 몸만 자기 자리에 앉아, 줄과 실제 위치가 어긋난다.
    const tile = tiles[Math.min(order, tiles.length - 1)];
    const body = bodies[agentType];
    if (!tile || !body) {
      return;
    }
    // 이미 그 자리에 서 있거나 그리로 걷는 중이면 다시 걸지 않는다 — 폴링마다 다시 걸면
    // 줄이 계속 들썩이고, 걷던 경로가 매번 처음부터 다시 시작된다.
    const goal = body.path?.[body.path.length - 1] ?? {
      x: Math.round(body.x),
      y: Math.round(body.y),
    };
    if (goal.x === tile.x && goal.y === tile.y) {
      return;
    }
    strolling.delete(agentType);
    walkTo(agentType, tile, { facing: "up" });
  });

  // 줄에서 빠진 사람은 자기 자리로 돌려보낸다.
  for (const agentType of left ?? []) {
    if (!bodies[agentType]) {
      continue;
    }
    const seat = seatOf(agentType);
    if (!seat || !walkTo(agentType, seat, { onArrive: () => sendHome(agentType) })) {
      sendHome(agentType);
    }
  }
}

/**
 * 카드 하나가 얼마나 방치됐는지 — 1(줄에 섬) · 2(서류를 듦) · 3(발을 구름) · 4(경고등).
 *
 * 시각을 못 읽거나 유효 구간이 0 이하면 **최고 단계**로 읽는다. "계산 불가 = 안 급함" 으로
 * 읽으면 값이 깨진 카드가 조용히 차분한 얼굴로 만료된다.
 */
function pressureOf(approval, now) {
  const createdAt = Date.parse(approval.createdAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (Number.isNaN(createdAt) || Number.isNaN(expiresAt) || expiresAt <= createdAt) {
    return 4;
  }
  // 시계가 어긋나 now 가 생성보다 이를 수 있다. 음수 비율은 1단계로 접는다.
  const consumed = Math.max(0, (now - createdAt) / (expiresAt - createdAt));
  if (consumed >= PRESSURE_THRESHOLDS.alarm) {
    return 4;
  }
  if (consumed >= PRESSURE_THRESHOLDS.tapping) {
    return 3;
  }
  if (consumed >= PRESSURE_THRESHOLDS.holdingPapers) {
    return 2;
  }
  return 1;
}

/**
 * 줄 선 사람마다 방치 단계를 다시 매긴다.
 *
 * 한 사람이 카드를 여럿 들고 있어도 **가장 급한 것만** 화면에 반영한다(배열 순서와 무관하게).
 * 예: `BE_SANDBOX_APPLY` 와 `BE_SANDBOX_PUSH_PR` 은 둘 다 BE 로 매핑된다.
 */
function applyApprovalPressure() {
  const now = Date.now();
  const highest = {};
  for (const approval of approvals) {
    const agentType = approval.agentType;
    if (!agentType || !bodies[agentType]) {
      continue;
    }
    highest[agentType] = Math.max(
      highest[agentType] ?? 0,
      pressureOf(approval, now)
    );
  }
  for (const [agentType, body] of Object.entries(bodies)) {
    body.pressure = highest[agentType] ?? 0;
  }
  presidentAlarm = Object.values(highest).some((stage) => stage === 4);
}

/** 격자 위 최단 경로(BFS). 이동 비용이 칸마다 같고 맵이 작아 A* 가 필요 없다. */
function findPath(start, goal, walkable) {
  const key = (tile) => `${tile.x},${tile.y}`;
  if (key(start) === key(goal) || !walkable.has(key(goal))) {
    return [];
  }
  const cameFrom = new Map();
  const visited = new Set([key(start)]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    // 상하좌우 네 칸. 대각선을 빼는 이유는 캐릭터가 책상 모서리를 가로지르지 않게 하기 위함이다.
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      const nextKey = key(next);
      if (!walkable.has(nextKey) || visited.has(nextKey)) {
        continue;
      }
      visited.add(nextKey);
      cameFrom.set(nextKey, current);
      if (nextKey === key(goal)) {
        const path = [];
        let step = next;
        while (step && key(step) !== key(start)) {
          path.unshift(step);
          step = cameFrom.get(key(step));
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

/**
 * 자리에서 일어나 목적지까지 걸어간다.
 *
 * 도달할 수 없으면 걷지 않는다 — 순간이동시키면 사람이 벽을 통과한 것처럼 보인다.
 */
function walkTo(agentType, goal, options = {}) {
  const body = bodies[agentType];
  if (!body) {
    return false;
  }
  const start = { x: Math.round(body.x), y: Math.round(body.y) };
  const path = findPath(start, goal, renderer.walkable);
  if (path.length === 0) {
    return false;
  }
  body.seated = false;
  body.path = path;
  body.stepIndex = 0;
  body.stepProgress = 0;
  body.walkStep = 0;
  body.onArrive = options.onArrive ?? null;
  body.dwellSeconds = options.dwellSeconds ?? 0;
  body.arriveFacing = options.facing ?? null;
  body.arrivePose = options.pose ?? null;
  body.arriveKind = options.kind ?? "자리";
  body.interactionPose = null;
  // **머무는 중이던 사람도 지금부터 걷는다.** 이걸 안 끊으면 `advanceBodies` 가 체류를 먼저
  // 처리하고, 체류가 끝나는 순간 자리로 돌아가는 걸음이 방금 건 경로를 덮어쓴다 — 퇴근하라고
  // 보낸 사람이 소파에서 일어나 자기 책상으로 돌아가 앉는다.
  //
  // 부르는 쪽마다 지우게 하지 않는 이유는 그 지점이 이미 셋이기 때문이다(퇴근·줄 세우기·일이
  // 들어와 복귀). 맥 앱은 배회가 액션이라 `cancelStroll` 이 통째로 지우는데, 이쪽은 상태값이라
  // 걸음을 지시하는 이 한 곳에서 끊어야 한 군데만 고쳐도 셋이 같이 낫는다.
  body.dwellRemaining = 0;
  return true;
}

/**
 * 한 프레임만큼 사람을 움직인다.
 *
 * 걸음 그림 두 장을 한 칸마다 번갈아 쓴다 — "한 칸 = 한 걸음" 과 맞다.
 */
function advanceBodies(deltaSeconds) {
  for (const [agentType, body] of Object.entries(bodies)) {
    // 출퇴근 계단식 지연. `setTimeout` 대신 여기서 세는 이유는 두 가지다 — 정지 렌더의 가상
    // 시간에서 돌지 않아 **걷는 중을 그림으로 확인할 방법이 없어지고**, 창이 뒤에 깔리면
    // 브라우저가 타이머를 늦춰 사람마다 도착 간격이 제멋대로가 된다.
    if (body.delayRemaining > 0) {
      body.delayRemaining -= deltaSeconds;
      if (body.delayRemaining <= 0) {
        body.delayRemaining = 0;
        const start = body.onDelayEnd;
        body.onDelayEnd = null;
        start?.();
      }
      continue;
    }
    if (body.dwellRemaining > 0) {
      body.dwellRemaining -= deltaSeconds;
      if (body.dwellRemaining <= 0) {
        body.dwellRemaining = 0;
        // 볼일이 끝났으면 자기 자리로 돌아간다.
        const seat = seatOf(agentType);
        if (seat && !walkTo(agentType, seat, { onArrive: () => sendHome(agentType) })) {
          sendHome(agentType);
        }
      }
      continue;
    }
    if (!body.path || body.stepIndex >= body.path.length) {
      continue;
    }
    const from =
      body.stepIndex === 0
        ? { x: Math.round(body.x), y: Math.round(body.y) }
        : body.path[body.stepIndex - 1];
    const to = body.path[body.stepIndex];
    body.stepProgress += deltaSeconds / STEP_SECONDS;
    if (body.stepProgress >= 1) {
      body.x = to.x;
      body.y = to.y;
      body.stepIndex += 1;
      body.stepProgress = 0;
      body.walkStep += 1;
      if (body.stepIndex >= body.path.length) {
        body.path = null;
        if (body.arriveFacing) {
          body.facing = body.arriveFacing;
        }
        body.pose = characterSpriteFor(body.facing).pose;
        if (body.dwellSeconds > 0) {
          body.dwellRemaining = body.dwellSeconds;
          body.dwellSeconds = 0;
          // 가구 앞에 도착하면 그 가구가 정한 자세를 잡는다. 소파·의자는 앉고, 나머지는
          // 선 채로 그 방향을 본다 — 서서 쓰는 물건(커피머신·게시판) 앞에서 앉으면
          // 그 사람만 바닥에 주저앉은 그림이 된다.
          body.interactionPose = body.arrivePose ?? null;
          body.seated = body.interactionPose === "sitting";
        } else if (body.onArrive) {
          const arrive = body.onArrive;
          body.onArrive = null;
          arrive();
        }
        continue;
      }
    } else {
      body.x = from.x + (to.x - from.x) * body.stepProgress;
      body.y = from.y + (to.y - from.y) * body.stepProgress;
    }
    const next = body.path?.[body.stepIndex] ?? to;
    body.facing = facingBetween(from, next);
    const still = characterSpriteFor(body.facing).pose;
    body.pose = `${still}-walk${(body.walkStep % 2) + 1}`;
  }
}

function facingBetween(from, to) {
  if (to.x > from.x) {
    return "right";
  }
  if (to.x < from.x) {
    return "left";
  }
  return to.y > from.y ? "up" : "down";
}

/**
 * 일이 없는 사람을 하나둘 산책 보낸다.
 *
 * 오래 움직이지 않은 사람부터 고르면 입력 순서가 달라도 같은 회차가 같은 결과를 낸다.
 * 일이 도는 사람(진행 중·승인 대기)은 자리를 지킨다 — 화면에서 "지금 무슨 일이 도는지" 가
 * 먼저 읽혀야 하는데, 그 사람이 복도에 있으면 자리와 상태가 따로 논다.
 */
/**
 * 이 사람의 일과 어울리는 목적지 하나. 짝지어진 가구가 없거나 다 차 있으면 null.
 *
 * 우선순위 목록은 맥 앱이 계산해 배치 JSON 에 실어 보낸다(`agentLooks[*].workAffinity`) —
 * 어느 워커가 무엇을 쓰는지는 워커가 늘 때마다 바뀌는 표라, 두 곳에 적으면 새 워커가
 * 한쪽 화면에서만 제 일을 한다.
 *
 * 같은 종류 가구가 여섯 방에 흩어져 있으므로 **자기 자리에서 가장 가까운 것**을 고른다.
 * 거리를 안 보면 개발실 사람이 성장실 벽 모니터까지 스무 칸을 걸어가, 왕복하는 동안
 * 화면에서는 일하러 간 것이 아니라 자리를 비운 것으로 읽힌다.
 */
function affinitySpot(agentType, free) {
  const kinds = renderer.layout.agentLooks?.[agentType]?.workAffinity ?? [];
  if (kinds.length === 0) {
    return null;
  }
  const home = seatOf(agentType);
  for (const kind of kinds) {
    const matched = free.filter((spot) => spot.kind === kind);
    if (matched.length === 0) {
      continue;
    }
    // 자리를 못 찾은 사람(좌석 배정 밖)은 거리를 잴 기준이 없다 — 목록 순서대로 첫 칸.
    if (!home) {
      return matched[0];
    }
    const steps = (tile) =>
      Math.abs(home.x - tile.x) + Math.abs(home.y - tile.y);
    return matched.reduce((best, spot) =>
      steps(spot.tile) < steps(best.tile) ? spot : best
    );
  }
  return null;
}

function strollTick(now) {
  const remaining = STROLL_CONCURRENCY - strolling.size;
  if (remaining <= 0) {
    return;
  }
  const spots = renderer.layout.strollSpots ?? [];
  if (spots.length === 0) {
    return;
  }
  const candidates = Object.keys(bodies)
    .filter((agentType) => {
      const body = bodies[agentType];
      const state = agents[agentType]?.state;
      if (!body?.seated || strolling.has(agentType)) {
        return false;
      }
      // 줄 선 사람과 출퇴근으로 걷는 중인 사람은 뽑지 않는다 — 우선순위가 배회보다 위라,
      // 여기서 뽑으면 두 걸음이 같은 사람을 서로 다른 곳으로 끌고 간다.
      if (queueOrder.includes(agentType) || commuting.has(agentType)) {
        return false;
      }
      if (state === "IN_PROGRESS" || state === "AWAITING_APPROVAL") {
        return false;
      }
      const last = lastStrollAt[agentType];
      return last === undefined || now - last >= STROLL_COOLDOWN_SECONDS;
    })
    .sort((left, right) => {
      const leftAt = lastStrollAt[left] ?? -Infinity;
      const rightAt = lastStrollAt[right] ?? -Infinity;
      return leftAt !== rightAt ? leftAt - rightAt : left.localeCompare(right);
    })
    .slice(0, remaining);

  for (const agentType of candidates) {
    // 목적지는 회차마다 갈리되 사람에 따라 다르게 — 같은 자리에 둘이 겹쳐 서지 않게 한다.
    //
    // **가려는 칸으로 센다.** 지금 서 있는 칸으로 세면, 방금 출발한 사람은 아직 자기 자리에
    // 있어서 그가 향하는 목적지가 비어 보인다 — 같은 회차의 두 번째 사람이 같은 칸을 골라
    // 소파 하나에 둘이 겹쳐 앉는다.
    const taken = new Set(
      Object.values(bodies)
        .filter((body) => body.path || body.dwellRemaining > 0)
        .map((body) => {
          const goal = body.path?.[body.path.length - 1] ?? body;
          return `${Math.round(goal.x)},${Math.round(goal.y)}`;
        })
    );
    const free = spots.filter(
      (spot) => !taken.has(`${spot.tile.x},${spot.tile.y}`)
    );
    if (free.length === 0) {
      return;
    }
    // 점심시간에는 탕비실·회의실로 기운다. 그 시간대에 그쪽 자리가 하나도 비어 있지 않으면
    // 평소처럼 전체에서 고른다 — 갈 곳이 없다고 자리에 붙들어 두면 정오만 화면이 굳는다.
    // **점심시간인지를 따로 들고 있어야 한다.** 한때 `lunch.length === 0` 하나로 갈랐는데,
    // 그 값은 "점심시간이 아니다" 와 "점심시간이지만 그쪽 자리가 다 찼다" 를 구별하지 못한다 —
    // 후자에서 업무 짝짓기가 켜져, 맥(`officeStrollSpot`)이 전체에서 회전 선택하는 상황에
    // 웹만 각자 자기 물건 앞으로 갔다. 같은 시각에 두 화면의 사람이 다른 방에 모인다.
    const isLunchHour =
      currentHour() === renderer.layout.attendanceHours.lunch;
    const lunch = isLunchHour
      ? free.filter((candidate) => LUNCH_KINDS.has(candidate.kind))
      : [];
    // 점심이 아니면 자기 일에 필요한 물건이 먼저다 — 자료를 찾는 사람은 책장, 문서를
    // 내보내는 사람은 프린터로. 짝지어진 물건이 없으면 평소처럼 전체에서 고른다.
    const affinity = isLunchHour ? null : affinitySpot(agentType, free);
    const pool = lunch.length > 0 ? lunch : free;
    const spot = affinity ?? pool[Math.floor(Math.random() * pool.length)];
    if (
      walkTo(agentType, spot.tile, {
        dwellSeconds: spot.dwellSeconds,
        facing: spot.facing,
        pose: spot.pose,
        kind: spot.kind,
      })
    ) {
      strolling.add(agentType);
      lastStrollAt[agentType] = now;
      const body = bodies[agentType];
      const previousArrive = body.onArrive;
      body.onArrive = () => {
        previousArrive?.();
        strolling.delete(agentType);
      };
    }
  }
}

// MARK: - 백엔드

async function fetchSnapshot() {
  const response = await fetch("/v1/console/snapshot");
  if (!response.ok) {
    throw new Error(`스냅샷 실패 (HTTP ${response.status})`);
  }
  const payload = await response.json();
  return payload.data ?? payload;
}

function applySnapshot(data) {
  agents = Object.fromEntries(
    (data.agents ?? []).map((agent) => [agent.agentType, agent])
  );
  sessions = (data.sessions ?? [])
    .filter((session) => isPresent(session))
    .map((session) => ({
      label: shortSessionName(session.name),
      active: session.state === "active",
    }));
  approvals = data.approvals ?? [];
  if (pressureDemo > 0) {
    const demos = demoApprovals();
    approvals = [...approvals, ...demos];
    // 카드만 넣으면 그 사람의 **상태**는 그대로라 발밑 링과 이름표가 평소 색으로 남는다 —
    // 실제 승인이 열릴 때는 상태도 함께 바뀌므로, 데모도 같은 그림이 되게 맞춘다.
    for (const demo of demos) {
      if (agents[demo.agentType]) {
        agents[demo.agentType] = {
          ...agents[demo.agentType],
          state: "AWAITING_APPROVAL",
        };
      }
    }
  }
  for (const agentType of Object.keys(bodies)) {
    if (!agents[agentType]) {
      despawn(agentType);
    }
  }
  // 줄을 먼저 맞춘다 — 출근 판정이 `isQueued` 를 시각보다 앞세우므로, 이번 스냅샷에서 막
  // 승인 대기로 들어온 사람도 그 판정에 잡혀야 한다.
  const leftQueue = reconcileQueue();
  // 스냅샷은 20초마다 오지만 시각 경계는 하루 몇 번뿐이다. 경계를 넘었을 때만 걷게 한다.
  const hour = currentHour();
  const crossed = lastAttendanceHour !== null && lastAttendanceHour !== hour;
  lastAttendanceHour = hour;
  applyAttendance(crossed && !isStatic);
  // 줄 걷기는 사람이 놓인 **뒤에** 건다.
  settleQueue(leftQueue);
  applyApprovalPressure();
  agentsWithoutSeat = Object.keys(agents).filter(
    (agentType) => !renderer.seatsByAgent.has(agentType)
  );
}

/**
 * `?pressure=N` 이 요청한 방치 단계에 딱 걸리는 가짜 승인 카드.
 *
 * 단계 문턱(25% · 50% · 80%)보다 조금 넘긴 소진율을 쓴다 — 문턱에 정확히 맞추면 계산
 * 오차 한 틱에 아래 단계로 떨어져, 확인하려던 그림이 안 나오는 회차가 생긴다.
 */
function demoApprovals() {
  const consumed = { 1: 0.05, 2: 0.3, 3: 0.55, 4: 0.83 }[pressureDemo] ?? 0.83;
  const lifespanMs = 60 * 60 * 1000;
  const createdAt = new Date(Date.now() - lifespanMs * consumed);
  // 평면도의 앞쪽 좌석 주인들에게 붙인다. 없는 사람에게 붙이면 줄에 설 몸이 없어 카드만 뜬다.
  return renderer.plan.desks.slice(0, Math.max(1, queueDemo)).map((desk, index) => ({
    id: `pressure-demo-${index}`,
    agentType: desk.agentType,
    title: "방치 압력 데모",
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + lifespanMs).toISOString(),
  }));
}

/**
 * 아직 사무실에 남아 있는 세션인가. 조용한 지 오래면 퇴근한 것으로 본다.
 *
 * 시각을 못 읽는 경우는 **남긴다.** 읽기 실패로 지우면 화면에서 조용히 사라지는데, 그건
 * 정확히 이 판정이 없애려는 현상이다.
 */
function isPresent(session) {
  const stamp = session.lastActivityAt ?? session.startedAt;
  const last = stamp ? Date.parse(stamp) : NaN;
  if (Number.isNaN(last)) {
    return true;
  }
  const quiet = (Date.now() - last) / 1000;
  return quiet < (renderer?.metrics.sessionLeaveAfterSeconds ?? 900);
}

/**
 * 책상 이름표에 쓸 짧은 이름.
 *
 * 세션 이름은 실행 디렉터리에서 오므로 길다. 뒤쪽을 남기는 이유는 앞이 대개 같은 저장소
 * 이름이기 때문이다 — 여러 세션을 가르는 정보는 뒤(워크트리·브랜치 이름)에 있다.
 */
function shortSessionName(name) {
  if (!name) {
    return "세션";
  }
  const budget = 14;
  if (name.length <= budget) {
    return name;
  }
  // 단어 중간에서 끊으면 앞 글자가 같은 이름표가 나란히 선다. `-`·`_` 경계 중 예산에
  // 들어오는 가장 긴 꼬리를 고른다.
  for (let index = 0; index < name.length; index += 1) {
    if ((name[index] === "-" || name[index] === "_") && name.length - index - 1 <= budget) {
      return name.slice(index + 1);
    }
  }
  return name.slice(-budget);
}

/**
 * 실시간 스트림. 상태가 바뀐 사람만 바로 반영하고, 나머지는 스냅샷이 맞춘다.
 *
 * 끊기면 다시 붙는다 — 브라우저의 EventSource 가 알아서 재연결하지만, 그동안 놓친 변화는
 * 다음 스냅샷이 메운다.
 */
function subscribe() {
  const stream = new EventSource("/v1/console/stream");
  stream.onmessage = (message) => {
    let event = null;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    const payload = event.data ?? event;
    const agentType = payload.agentType ?? payload.agent?.agentType;
    if (agentType && agents[agentType]) {
      if (payload.state) {
        agents[agentType] = { ...agents[agentType], state: payload.state };
      }
      if (payload.bubble) {
        agents[agentType] = { ...agents[agentType], bubble: payload.bubble };
      }
      // 일이 시작되면 자리로 돌아온다 — 복도에 선 채 "진행 중" 인 화면은 읽히지 않는다.
      if (payload.state === "IN_PROGRESS" && strolling.has(agentType)) {
        const seat = seatOf(agentType);
        strolling.delete(agentType);
        if (seat) {
          walkTo(agentType, seat, { onArrive: () => sendHome(agentType) });
        }
      }
    }
    // **이벤트만으로는 화면을 다 채울 수 없다.** `state.changed` 는 상태만 싣고 활동
    // 문구를 주지 않으며, 승인 열림·해소는 그 사람의 파생 상태를 담지 않는다. 그대로 두면
    // "지금 무슨 일 중" 이 다음 폴링(20초)까지 옛 값으로 남고, 그보다 짧게 끝나는 실행은
    // 문구가 한 번도 안 뜬다. 그래서 이벤트가 오면 스냅샷을 당겨 온다.
    scheduleSnapshot();
  };
  stream.onerror = () => {
    setStatus("실시간 연결이 끊겼다 — 다시 붙는 중", true);
  };
}

/**
 * 정지 렌더에서 시간을 가상으로 흘린다.
 *
 * 실제 루프와 **같은 프레임 간격**으로 잘라 넣어야 한 칸씩 밟고 지나가는 경로와 자세가 같은
 * 방식으로 재현된다. 한 번에 큰 값을 넣으면 사람이 여러 칸을 건너뛰어 벽을 통과한 그림이 나온다.
 */
function advanceVirtually(seconds) {
  const step = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    advanceBodies(step);
  }
}

/** 예약된 스냅샷 재동기화. 이벤트가 몰려 와도 요청은 한 번만 나간다. */
let snapshotTimer = null;

/**
 * 곧 스냅샷을 다시 받는다.
 *
 * 이벤트마다 바로 부르면 안 된다 — 체인 하나가 시작되면 `run.started`·`state.changed`·
 * 말풍선이 잇따라 오고, 사람이 여럿 얽힌 회의면 한 번에 수십 개가 몰린다. 짧게 묶어
 * 마지막 이벤트 뒤 한 번만 요청한다.
 */
function scheduleSnapshot() {
  if (snapshotTimer !== null) {
    return;
  }
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    refreshSnapshot();
  }, 400);
}

let snapshotFailures = 0;

async function refreshSnapshot() {
  try {
    applySnapshot(await fetchSnapshot());
    snapshotFailures = 0;
    setStatus(summary(), hasStaleLayout());
  } catch (error) {
    snapshotFailures += 1;
    setStatus(`${error} (${snapshotFailures}회)`, true);
  }
}

/**
 * 화면 좌상단 요약 카드에 적을 숫자 — 맥 앱 `companySummary` 와 같은 항목.
 *
 * "대기" 가 아니라 "쉬는 중" 이라고 부른다. 이대리에 밀린 일감 큐는 없고 이 숫자는 **지금
 * 맡은 일이 없는 사람 수**(서른 중 스물일곱이 예사)다. 적체로 읽히면 화면이 늘 비상처럼 보인다.
 */
function summaryCounts() {
  const tally = Object.values(agents).reduce((counts, agent) => {
    counts[agent.state] = (counts[agent.state] ?? 0) + 1;
    return counts;
  }, {});
  return {
    inProgress: tally.IN_PROGRESS ?? 0,
    awaitingApproval: tally.AWAITING_APPROVAL ?? 0,
    waiting: tally.WAITING ?? 0,
    sessions: sessions.length,
    activeSessions: sessions.filter((session) => session.active).length,
  };
}

function summary() {
  const counts = Object.values(agents).reduce((tally, agent) => {
    tally[agent.state] = (tally[agent.state] ?? 0) + 1;
    return tally;
  }, {});
  const stale =
    agentsWithoutSeat.length > 0
      ? ` · 평면도에 자리 없는 사람 ${agentsWithoutSeat.length}명(${agentsWithoutSeat.join(", ")})` +
        ` — 평면도를 다시 뽑아야 한다`
      : "";
  return (
    `${currentHour()}시 출근 ${Object.keys(bodies).length}/${Object.keys(agents).length}명` +
    ` · 진행 ${counts.IN_PROGRESS ?? 0} · 승인 ${counts.AWAITING_APPROVAL ?? 0}` +
    ` · 쉬는 중 ${counts.WAITING ?? 0} · 세션 ${sessions.length}` +
    ` · ${renderer.plan.columns}×${renderer.plan.rows} 칸 · 타일 ${renderer.tileSize.toFixed(1)}px` +
    ` · 그림 ${loadedSpriteCount}장${stale}`
  );
}

/** 평면도가 낡았는지. 상태 줄을 붉게 만들어 그냥 지나치지 못하게 한다. */
function hasStaleLayout() {
  return agentsWithoutSeat.length > 0;
}

function setStatus(text, isError = false) {
  status.textContent = text;
  status.className = isError ? "error" : "";
}

// MARK: - 시작

async function main() {
  setStatus("평면도를 읽는 중…");
  const [three, two] = await Promise.all([
    fetch("layout-3.json").then((response) => response.json()),
    fetch("layout-2.json").then((response) => response.json()),
  ]);
  layouts = { 3: three, 2: two };
  // 옛 평면도는 출퇴근 시각을 싣고 오지 않는다. 그대로 두면 첫 출근 판정에서 죽는데, 화면에는
  // **아무 오류 없이 빈 사무실**이 남아 "백엔드가 꺼졌다" 와 구별되지 않는다. 설치본은 평면도를
  // 빌드에 동봉하므로(README) 앱을 다시 만들지 않는 한 이 상태가 계속된다 — 여기서 끊는다.
  for (const [columns, layout] of Object.entries(layouts)) {
    if (!layout.attendanceHours) {
      throw new Error(
        `layout-${columns}.json 이 낡았다 — 출퇴근 시각(attendanceHours)이 없다. 평면도를 다시 뽑아라`
      );
    }
    // 판 두께를 재는 값이 없으면 `fontSize + undefined` 가 NaN 이 되어, 이름표·말풍선·문패가
    // 좌표 없이 그려진다 — 오류 한 줄 없이 글자만 사라지므로 여기서 이름을 대고 끊는다.
    if (typeof layout.metrics?.labelBoxOverhead !== "number") {
      throw new Error(
        `layout-${columns}.json 이 낡았다 — 글자 상자 몫(labelBoxOverhead)이 없다. 평면도를 다시 뽑아라`
      );
    }
  }
  resize();

  setStatus("그림을 받는 중…");
  // 두 배치가 쓰는 그림은 같다 — 한쪽 기준으로 받아 두면 창을 돌려도 다시 안 받는다.
  const wanted = renderer.spriteNames();
  loadedSpriteCount = await preloadSprites(wanted);
  // 한 장도 못 받으면 화면이 **아무 오류 없이** 텅 빈다 — 그리는 쪽이 없는 그림을 조용히
  // 건너뛰기 때문이다. 빈 사무실과 구별되지 않으므로 여기서 끊는다.
  if (loadedSpriteCount === 0) {
    throw new Error(`그림을 한 장도 못 받았다 (${wanted.length}장 요청)`);
  }

  await refreshSnapshot();
  window.addEventListener("resize", resize);

  // 정지 렌더는 한 판 그리고 끝난다 — 스냅샷을 못 받은 채로 그리면 **사람이 0명인 사무실이
  // 정상 그림처럼 저장되고**, 그게 "백엔드가 꺼졌다"·"서버 주소가 틀렸다" 와 구별되지 않는다.
  // 움직이는 화면은 20초마다 다시 받아 스스로 메우지만 정지 렌더에는 그 기회가 없다.
  // (1단계가 빈 평면도를 실패로 끊는 것과 같은 이유다.)
  if (isStatic && snapshotFailures > 0) {
    throw new Error("스냅샷을 못 받아 그리지 않았다 — 서버 주소와 백엔드를 확인하라");
  }

  if (isStatic) {
    // 줄서기는 걸어가야 완성된다. 정지 렌더는 프레임 루프를 돌리지 않으므로 `?pressure=` 로
    // 줄을 세워 놓고도 사람은 자기 자리에 앉은 그림이 나온다 — 가상 시간으로 밀어 준다.
    if (pressureDemo > 0 && walkSeconds === 0 && commuteSeconds === 0) {
      advanceVirtually(8);
    }
    if (commuteSeconds > 0) {
      const hours = renderer.layout.attendanceHours;
      const hour = currentHour();
      const working = hour >= hours.earlyBirdStart && hour < hours.departure;
      if (working) {
        // 출근 — 아직 아무도 오지 않은 상태에서 시작한다.
        for (const agentType of Object.keys(bodies)) {
          despawn(agentType);
        }
      } else {
        // 퇴근 — 방금 전까지 자리에 있던 것으로 놓고 내보낸다.
        for (const entry of renderer.plan.desks) {
          if (agents[entry.agentType]) {
            sendHome(entry.agentType);
          }
        }
        // 배회하다 소파에 앉은 사람을 섞는다. 전원이 자리에 앉은 상태에서만 내보내면 "머무는
        // 중이던 사람이 퇴근하는가" 라는, 정확히 어긋나기 쉬운 경우가 확인에서 통째로 빠진다.
        strollTick(0);
        advanceVirtually(7);
      }
      applyAttendance(true);
      advanceVirtually(commuteSeconds);
      const walking = Object.values(bodies).filter((body) => body.path).length;
      const waiting = Object.values(bodies).filter(
        (body) => body.delayRemaining > 0
      ).length;
      const report =
        `${working ? "출근" : "퇴근"} ${commuteSeconds}초 — 화면에 ${Object.keys(bodies).length}명` +
        ` · 걷는 중 ${walking}명 · 대기 ${waiting}명`;
      console.log(report);
      document.body.dataset.commuteReport = report;
    }
    if (walkSeconds > 0) {
      // 산책을 일으키고 가상 시간으로 진행시킨다. 프레임 간격은 실제 루프와 같은 크기로
      // 잘라 넣고 배회 틱도 같은 주기로 돌려야, 한 칸씩 밟고 지나가는 경로와 자세가 같은
      // 방식으로 재현된다.
      //
      // **누가 도착하면 거기서 멈춘다.** 끝까지 돌리면 머무는 시간(3~8초)이 지나 전원이
      // 자리로 돌아가 버려, 확인하려던 그림이 화면에 남지 않는다.
      const step = 1 / 60;
      let tickedAt = -STROLL_TICK_SECONDS;
      for (let elapsed = 0; elapsed < walkSeconds; elapsed += step) {
        if (elapsed - tickedAt >= STROLL_TICK_SECONDS) {
          tickedAt = elapsed;
          strollTick(elapsed);
        }
        advanceBodies(step);
        if (Object.values(bodies).some((body) => body.dwellRemaining > 0)) {
          break;
        }
      }
      // 어느 가구 앞에 어느 자세로 섰는지까지 남긴다. 자세만 찍으면 사람과 가구가 겹치는
      // 자리에서 "이 사람이 그 가구를 쓰고 있는지" 를 눈으로 확정할 수 없다.
      const posed = Object.entries(bodies)
        .filter(([, body]) => body.dwellRemaining > 0)
        .map(
          ([agentType, body]) =>
            `${agentType}:${body.interactionPose ?? "서기"}@${body.arriveKind}` +
            `(${Math.round(body.x)},${Math.round(body.y)})→${body.facing}`
        );
      const walking = Object.values(bodies).filter((body) => body.path).length;
      const report = `걷는 중 ${walking}명 · 도착 ${posed.length}명 [${posed.join(", ")}]`;
      console.log(report);
      // 콘솔은 화면 캡처 도구가 가져가지 못한다. 어디에 누가 섰는지 확인하려고 띄운 입구인데
      // 그 결과가 도구에서 안 보이면 사람이 브라우저를 여는 것 말고는 확인할 방법이 없다.
      document.body.dataset.walkReport = report;
    }
    // 인원을 숫자로도 남긴다. 그림만 보면 출근 규칙이 통째로 빠져도 새벽 화면은 원래
    // 빈 사무실과 구분되지 않아 통과한다(맥 앱이 시각별 착석 인원을 직접 세는 것과 같은 이유).
    // 줄 명단에 있으면서 실제로는 자기 책상에 앉아 있는 사람을 따로 센다. 그림만 보면 그 사람은
    // "그냥 앉아 있는 사람" 과 구별되지 않아, 자리를 못 받은 것이 조용히 지나간다.
    const misplaced = queueOrder.filter((agentType) => {
      const body = bodies[agentType];
      const seat = renderer.seatsByAgent.get(agentType);
      return body && seat && Math.round(body.x) === seat.x && Math.round(body.y) === seat.y;
    });
    const report =
      `${currentHour()}시 착석 ${Object.keys(bodies).length}명 / 전체 ${Object.keys(agents).length}명` +
      ` · 줄 ${queueOrder.length}명(자리 ${renderer.plan.queueTiles.length}칸` +
      `, 제자리에 남은 사람 ${misplaced.length}명)${presidentAlarm ? " · 대표 경고등" : ""}`;
    console.log(report);
    document.body.dataset.queueReport = report;
    // 한 판만 그리고 멈춘다. 사람은 전부 제자리에 앉아 있으므로 두 화면을 칸 단위로 대조할 수 있다.
    renderOnce();
    return;
  }

  subscribe();
  setInterval(refreshSnapshot, SNAPSHOT_INTERVAL_SECONDS * 1000);

  let previous = performance.now();
  const frame = (timestamp) => {
    const deltaSeconds = Math.min(0.1, (timestamp - previous) / 1000);
    previous = timestamp;
    const now = timestamp / 1000;
    if (now - lastTickAt >= STROLL_TICK_SECONDS) {
      lastTickAt = now;
      strollTick(now);
    }
    // 시각 경계는 이벤트를 내지 않는다 — 시간축으로 훑지 않으면 9시가 지나도 아무도 안 온다.
    if (now - lastAttendanceTickAt >= ATTENDANCE_TICK_SECONDS) {
      lastAttendanceTickAt = now;
      const hour = currentHour();
      if (hour !== lastAttendanceHour) {
        lastAttendanceHour = hour;
        applyAttendance(true);
      }
    }
    // 줄에 이미 선 카드는 시간이 흘러도 그 자체로는 이벤트를 내지 않는다. 훑지 않으면
    // 몇 시간을 방치돼도 서류를 들지도 발을 구르지도 않는다 — 이 기능이 막으려는 상황이다.
    if (now - lastPressureSweepAt >= PRESSURE_SWEEP_SECONDS) {
      lastPressureSweepAt = now;
      applyApprovalPressure();
    }
    advanceBodies(deltaSeconds);
    renderer.draw({
      agents,
      bodies,
      sessions,
      hour: currentHour(),
      // 켜진 모니터가 숨 쉬듯 밝기를 오간다 — 정지 화면이면 "지금 도는 중" 이 안 읽힌다.
      blink: (Math.sin(now * 2) + 1) / 2,
      now,
      presidentAlarm,
      summary: summaryCounts(),
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((error) => {
  setStatus(String(error), true);
  throw error;
});
