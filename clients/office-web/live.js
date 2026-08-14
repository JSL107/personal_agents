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
/** 동시 배회 인원. 서른 명이 한꺼번에 움직이면 사무실이 아니라 난장판이다. */
const STROLL_CONCURRENCY = 2;
/** 한 칸 걷는 데 걸리는 시간(초). 0.16 은 다리가 교차하기 전에 몸이 지나가 종종거려 보였다. */
const STEP_SECONDS = 0.2;
/** 스냅샷을 다시 받는 주기(초). 스트림이 끊겨도 화면이 굳지 않게 하는 안전망이다. */
const SNAPSHOT_INTERVAL_SECONDS = 20;

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
/** 실제로 받아 둔 그림 장수. 상태 줄에 찍어 에셋 누락이 조용히 지나가지 않게 한다. */
let loadedSpriteCount = 0;

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
  // **캔버스 크기를 정하면 그려 둔 그림이 지워진다.** 움직이는 화면은 다음 프레임이 다시
  // 채우지만 정지 렌더는 한 번만 그리므로, 창 크기가 뒤늦게 확정되면(캡처 도구가 그렇다)
  // 화면이 통째로 빈 채 남는다 — 오류도 없이 텅 빈 사무실이 저장됐다.
  const needsRepaint = canvas.width !== Math.round(width) || canvas.height !== Math.round(height);
  const next = chooseZoneColumns(width, height, zoneColumns);
  const layoutChanged = next !== zoneColumns;
  zoneColumns = next;
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  if (layoutChanged || !renderer) {
    renderer = renderer ?? new OfficeRenderer(canvas, layouts[zoneColumns]);
    renderer.setLayout(layouts[zoneColumns]);
    // 배치가 통째로 바뀌었으므로 걷던 사람도 자기 새 자리로 돌려보낸다 — 옛 좌표에 남으면
    // 방 한가운데 떠 있게 된다.
    for (const agentType of Object.keys(bodies)) {
      sendHome(agentType);
    }
  } else {
    renderer.measure();
  }
  if (isStatic && needsRepaint && loadedSpriteCount > 0) {
    renderOnce();
  }
}

/** 한 판 그린다. 정지 렌더 모드와 창 크기 변경이 같은 경로를 쓴다. */
function renderOnce() {
  renderer.draw({
    agents,
    bodies,
    sessions,
    hour: fixedHour ?? new Date().getHours(),
    blink: 1,
  });
  setStatus(summary());
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
  return true;
}

/**
 * 한 프레임만큼 사람을 움직인다.
 *
 * 걸음 그림 두 장을 한 칸마다 번갈아 쓴다 — "한 칸 = 한 걸음" 과 맞다.
 */
function advanceBodies(deltaSeconds) {
  for (const [agentType, body] of Object.entries(bodies)) {
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
    const taken = new Set(
      Object.values(bodies)
        .filter((body) => body.path || body.dwellRemaining > 0)
        .map((body) => `${Math.round(body.x)},${Math.round(body.y)}`)
    );
    const free = spots.filter(
      (spot) => !taken.has(`${spot.tile.x},${spot.tile.y}`)
    );
    if (free.length === 0) {
      return;
    }
    const spot = free[Math.floor(Math.random() * free.length)];
    if (
      walkTo(agentType, spot.tile, {
        dwellSeconds: spot.dwellSeconds,
        facing: spot.facing,
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
  for (const agentType of Object.keys(agents)) {
    if (!bodies[agentType]) {
      sendHome(agentType);
    }
  }
  for (const agentType of Object.keys(bodies)) {
    if (!agents[agentType]) {
      delete bodies[agentType];
    }
  }
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
    if (event.type?.startsWith("session")) {
      refreshSnapshot();
    }
  };
  stream.onerror = () => {
    setStatus("실시간 연결이 끊겼다 — 다시 붙는 중", true);
  };
}

let snapshotFailures = 0;

async function refreshSnapshot() {
  try {
    applySnapshot(await fetchSnapshot());
    snapshotFailures = 0;
    setStatus(summary());
  } catch (error) {
    snapshotFailures += 1;
    setStatus(`${error} (${snapshotFailures}회)`, true);
  }
}

function summary() {
  const counts = Object.values(agents).reduce((tally, agent) => {
    tally[agent.state] = (tally[agent.state] ?? 0) + 1;
    return tally;
  }, {});
  return (
    `진행 ${counts.IN_PROGRESS ?? 0} · 승인 ${counts.AWAITING_APPROVAL ?? 0}` +
    ` · 쉬는 중 ${counts.WAITING ?? 0} · 세션 ${sessions.length}` +
    ` · ${renderer.plan.columns}×${renderer.plan.rows} 칸 · 타일 ${renderer.tileSize.toFixed(1)}px` +
    ` · 그림 ${loadedSpriteCount}장`
  );
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

  if (isStatic) {
    if (walkSeconds > 0) {
      // 산책을 한 번 일으키고 가상 시간으로 진행시킨다. 프레임 간격은 실제 루프와 같은
      // 크기로 잘라 넣어야 한 칸씩 밟고 지나가는 경로가 같은 방식으로 재현된다.
      strollTick(0);
      const step = 1 / 60;
      for (let elapsed = 0; elapsed < walkSeconds; elapsed += step) {
        advanceBodies(step);
      }
      const walking = Object.values(bodies).filter((body) => body.path).length;
      const arrived = Object.values(bodies).filter((body) => body.dwellRemaining > 0).length;
      console.log(`걷는 중 ${walking}명 · 도착해 머무는 중 ${arrived}명`);
    }
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
    advanceBodies(deltaSeconds);
    renderer.draw({
      agents,
      bodies,
      sessions,
      hour: fixedHour ?? new Date().getHours(),
      // 켜진 모니터가 숨 쉬듯 밝기를 오간다 — 정지 화면이면 "지금 도는 중" 이 안 읽힌다.
      blink: (Math.sin(now * 2) + 1) / 2,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((error) => {
  setStatus(String(error), true);
  throw error;
});
