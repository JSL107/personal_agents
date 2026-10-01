// 3D 오피스 렌더러 — `office.js` 의 `OfficeRenderer` 와 같은 자리에 꽂힌다.
//
// live.js 는 렌더러에게 두 가지만 기대한다. ① 평면도를 읽어 좌석·통행 칸을 알려 줄 것
// (`plan`·`seatsByAgent`·`walkable`), ② 매 프레임 `draw(view)` 로 그릴 것. 누가 어디로
// 걷는지는 여전히 live.js 가 정하고, 여기서는 받은 좌표를 3D 로 옮겨 그리기만 한다.
//
// 좌표: 평면도 칸 (x, y) 는 y 가 위(북쪽)로 증가한다. 3D 에서는 칸 한 변 = 1, 북쪽 = -z.
// 칸 중심 = (x + 0.5, 0, -(y + 0.5)). 변환은 `world()` 한 곳에서만 한다.
//
// 바깥으로 내보내는 사건(맥 앱이 WKWebView 에서 받는다):
//   office:agent-click     {agentType}   사람을 눌렀다
//   office:president-click {}            대표를 눌렀다
//   office:focus           {department}  방 확대가 바뀌었다(null = 전체)
//   office:deselect        {}            바닥·배경을 눌러 선택이 풀렸다

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  BACKGROUND,
  FLOOR_COLORS,
  FLOOR_TINT,
  OUTLINE,
  SCALE,
  WALL_MOUNT,
  addOutlines,
  makeLights,
  mat,
  setOutlineWidth,
  tone,
} from "./style.js";
import { buildFurniture, missingKinds } from "./furniture3d/index.js";
import { makeCharacter, makeStatusRing, poseCharacter, seatOffset } from "./character.js";
import { BUBBLE_RAISE_PX, DOTS_RAISE_PX, Overlay3D } from "./overlay3d.js";
import { separateLabels } from "./label-separation.js";
import { PRESIDENT_COZY_LOOK } from "./cozy-looks.js";
import { showsBubble } from "../office.js";
import { frameSignature, shouldRender } from "./frame-pace.js";
import { mergeStatic } from "./static-merge.js";

/**
 * 카메라 각. 방위는 남쪽(+z)에서 동쪽으로 돈 각, 고도는 바닥에서 올려본 각.
 * 45° 정아이소메트릭은 가로로 긴 사무실(35×20)을 마름모로 세워 화면 위아래가 빈다 —
 * 방위를 줄여 가로 폭을 살린다. (2026-09-30 사용자 확정: 32°·38°)
 *
 * 방위는 **창 비율을 따른다**(`azimuthFor`). 32° 로 돌린 마름모는 가로로 넓은 창에는 맞지만 세로로 긴
 * 창에서는 폭에 맞춰 줄어들어 위아래가 비었다(사용자 보고: "화면에 비해 사무실이 너무 작다").
 * 960×1050 창에서 15° 는 타일이 25.6→29.7px 로 16% 커진다. 0° 까지 내리면 더 크지만 비스듬한
 * 조감이 사라져 평면도처럼 보인다 — 15° 에서 멈춘다.
 */
const CAMERA = {
  /** 가로÷세로가 `wideAspect` 이상이면 이 방위. */
  azimuthWide: 32,
  /** 가로÷세로가 `tallAspect` 이하면 이 방위. 사이는 선형으로 잇는다(창을 끌 때 튀지 않게). */
  azimuthTall: 15,
  wideAspect: 1.5,
  tallAspect: 1.0,
  elevationDegrees: 38,
  margin: 0.04,
  focusSeconds: 0.35,
};

/** 이 창에서 쓸 방위(도). 배치 고르기·방 확대 모두 같은 창이면 같은 값이라 전환 중에 흔들리지 않는다. */
export function azimuthFor(width, height) {
  const aspect = width / Math.max(1, height);
  const t = THREE.MathUtils.clamp((aspect - CAMERA.tallAspect) / (CAMERA.wideAspect - CAMERA.tallAspect), 0, 1);
  return CAMERA.azimuthTall + (CAMERA.azimuthWide - CAMERA.azimuthTall) * t;
}

/** 방 사이 벽 높이. 완전히 낮추면 벽걸이가 뜨고, 높이면 뒤쪽 방을 가린다 — 허리 높이. */
const WALL_MID = 0.5;
/**
 * 벽 두께. 평면도의 벽은 한 칸(=1)이지만 그대로 세우면 방 사이가 두꺼운 덩어리로 읽힌다
 * (첫 캡처). 칸 가운데에 얇게 세우고 나머지는 바닥으로 깐다.
 */
const WALL_THICKNESS = 0.22;

/**
 * 이름표를 또렷하게 띄우는 상태. 나머지(쉬는 중·완료)도 이름은 늘 띄우되 흐린 판(`.idle`)으로 —
 * 처음엔 hover 때만 띄웠는데 "이름 태그가 없어졌다" 가 됐다(2D 는 전원 이름이 늘 보인다).
 * 흐리게 두는 것은 서른 개가 같은 세기로 뜨면 일하는 사람이 묻히기 때문이다.
 */
const NAMED_STATES = new Set(["IN_PROGRESS", "AWAITING_APPROVAL", "FAILED"]);
const ALERT_STATES = new Set(["AWAITING_APPROVAL", "FAILED"]);
const STATE_LABELS = {
  IN_PROGRESS: "일하는 중",
  AWAITING_APPROVAL: "승인 대기",
  AWAITING_INTEGRATION: "반영 대기",
  COMPLETED: "완료",
  FAILED: "실패",
  WAITING: "쉬는 중",
};

/**
 * 로봇청소기 — 쓰레기통 앞(남쪽)을 좌우로 오간다. 자리는 2D `addVacuumRobot`·`addPendingDust` 와 같은
 * 칸 비율이다. 멈춰 설 때(충전 대기·고장)는 왕복 구간 오른쪽 끝 바깥에 선다.
 */
const VACUUM = { front: 0.46, travel: 0.62, legSeconds: 7, parkedX: 0.34, dustX: -0.82, dustFront: 0.3 };
/** 움직임 줄이기 설정이면 청소기를 세워 둔다(2D `addVacuumRobot` 과 같다). */
const REDUCE_MOTION = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const VACUUM_LED = { sweeping: 0x5cdb70, docked: 0x669ef0, stalled: 0xf0574f };

/** 대표 외형 — 평면도에 대표 몫 `agentLooks` 가 없어 `cozy-looks.js` 의 대표 몫을 쓴다. */
const PRESIDENT_LOOK = { cozy: PRESIDENT_COZY_LOOK };
const FALLBACK_LOOK = { sheet: "char", shirt: [0.8, 0.8, 0.8], pants: [0.3, 0.3, 0.3], hair: [0.3, 0.22, 0.16] };

/** 이름표·말풍선 높이(사람 발 기준). 이름표가 떠 있으면 말풍선은 화면 픽셀로 그 위에 선다(`.raised`). */
const LABEL_HEIGHT = SCALE.characterHeight + 0.14;
/** 겹침을 풀 때 판 사이에 두는 간격(px). */
const LABEL_GAP_PX = 2;

/**
 * 카메라를 범위 중심에 세우고, 범위의 모서리 여덟 개(바닥·벽 높이)가 다 들어가는 직교 범위를 잰다.
 * 렌더러와 배치 고르기(`Office3DRenderer.tileSizeFor`)가 같은 계산을 쓴다.
 */
function frameBounds(camera, bounds, width, height) {
  const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, -(bounds.minY + bounds.maxY) / 2);
  const azimuth = THREE.MathUtils.degToRad(azimuthFor(width, height));
  const elevation = THREE.MathUtils.degToRad(CAMERA.elevationDegrees);
  const distance = 200;
  camera.position.set(
    center.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
    Math.sin(elevation) * distance,
    center.z + Math.cos(azimuth) * Math.cos(elevation) * distance
  );
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const inverse = camera.matrixWorldInverse;
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const h of [0, SCALE.wallTall]) {
        const point = new THREE.Vector3(x, h, -y).applyMatrix4(inverse);
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        bottom = Math.min(bottom, point.y);
        top = Math.max(top, point.y);
      }
    }
  }
  // 화면 비율을 지키며 넓은 쪽에 맞춘다 — 늘이면 가구가 찌그러진다.
  const spanX = (right - left) * (1 + CAMERA.margin * 2);
  const spanY = (top - bottom) * (1 + CAMERA.margin * 2);
  const aspect = width / Math.max(1, height);
  const halfWidth = Math.max(spanX, spanY * aspect) / 2;
  return { left, right, bottom, top, halfWidth, halfHeight: halfWidth / aspect };
}

export class Office3DRenderer {
  /**
   * 이 창에 이 평면도를 조감으로 담았을 때 타일 한 칸의 화면 크기(캔버스 px).
   *
   * 3열(35×20)·2열(23×27) 중 무엇을 쓸지 live.js 가 이것으로 고른다. 2D 기준(`폭/열 · 높이/행`)은
   * 비스듬히 돌린 조감에 안 맞는다 — 2190×1556 창에서 2D 기준은 3열을 고르는데 3D 로는 2열이
   * 타일 60px 대 50px 로 더 크다(사용자 보고: "빈 화면이 너무 많다").
   */
  static tileSizeFor(plan, width, height) {
    const bounds = { minX: 0, maxX: plan.columns, minY: 0, maxY: plan.rows };
    const { halfWidth } = frameBounds(new THREE.OrthographicCamera(), bounds, width, height);
    return width / (halfWidth * 2);
  }

  constructor(canvas, layout) {
    this.canvas = canvas;
    // 2D 캔버스용 도트 보존 설정을 풀어 준다 — 3D 는 부드럽게 보간돼야 한다.
    canvas.style.imageRendering = "auto";
    this.webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // 정지 렌더 캡처가 그린 직후 버퍼를 읽는다. 끄면 캡처가 빈 화면을 받는 브라우저가 있다.
      preserveDrawingBuffer: true,
    });
    this.webgl.setPixelRatio(1);
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.overlay = new Overlay3D();
    this.raycaster = new THREE.Raycaster();
    this.pointer = null;
    this.hoveredAgent = null;
    this.selectedAgent = null;
    const query = new URLSearchParams(window.location.search);
    this.focusDepartment = query.get("room");
    this.listen();
    this.setLayout(layout);
  }

  setLayout(layout) {
    this.layout = layout;
    this.plan = layout.plan;
    this.metrics = layout.metrics;
    this.seatsByAgent = new Map(this.plan.desks.map((desk) => [desk.agentType, desk.seat]));
    this.deskByAgent = new Map(this.plan.desks.map((desk) => [desk.agentType, desk.desk]));
    this.walkable = new Set(this.plan.walkable.map((tile) => `${tile.x},${tile.y}`));
    this.buildScene();
    // 배치가 바뀌면 옛 방 확대는 뜻이 없다(방 좌표가 다르다) — 전체로 곧바로 되돌린다.
    this.viewBounds = this.focusBounds();
    this.tween = null;
    // 장면을 새로 지었다 — `measure` 가 다음 프레임을 그리게 한다.
    this.measure();
  }

  /** 2D 렌더러는 그림 파일을 미리 받는다. 3D 는 도형으로 만들어 받을 것이 없다. */
  spriteNames() {
    return [];
  }

  /** 빌더가 아직 없는 가구 종류(상태 줄 표시용). */
  missingFurniture() {
    return missingKinds(this.plan.furniture.map((placement) => placement.kind));
  }

  world(x, y, height = 0) {
    return new THREE.Vector3(x + 0.5, height, -(y + 0.5));
  }

  isWall(x, y) {
    return this.plan.floor[y]?.[x] === "wall";
  }

  // MARK: - 장면 만들기

  buildScene() {
    if (this.scene) {
      this.overlay.clear(this.scene);
      this.scene.traverse((node) => node.geometry?.dispose());
    }
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND);
    this.characters = new Map();
    // 클릭 판정 대상 — 매 프레임 장면 전체(외곽선 포함 수천 개)를 훑지 않게 따로 들고 있는다.
    this.hitTargets = [];
    this.buildFloor();
    this.buildWalls();
    this.buildFurniturePieces();
    this.buildPresident();
    this.buildPlates();
    const { columns, rows } = this.plan;
    const center = new THREE.Vector3(columns / 2, 0, -rows / 2);
    const [hemisphere, sun, sunTarget, fill, fillTarget] = makeLights(center, Math.max(columns, rows) * 0.75);
    this.lights = {
      hemisphere,
      sun,
      fill,
      base: { hemisphere: hemisphere.intensity, sun: sun.intensity, fill: fill.intensity },
    };
    this.scene.add(hemisphere, sun, sunTarget, fill, fillTarget);
    this.lightHour = null;
    // 외곽선은 장면을 다 만든 뒤 한 번에 — 가구·벽·창을 만드는 곳마다 붙이면 빠뜨린다.
    // 사람은 만들 때 스스로 붙인다(`makeCharacter`).
    addOutlines(this.scene);
    // 사람은 아직 장면에 없다(`draw` 가 넣는다) — 지금 있는 것은 전부 멈춘 물체다.
    // 나중에 움직일 물체(문·로봇 등)를 들이려면 이 줄 **뒤에** 넣어야 한다 — 앞에 넣으면 한 덩어리로 굳는다.
    mergeStatic(this.scene);
    this.buildDeskLamps();
    this.buildHousekeeping();
  }

  /**
   * 책상 스탠드 불빛 — 저녁·밤에 **자리에 앉은 사람의** 책상만 밝힌다(2D `updateDeskLamps`).
   * 빈 자리까지 켜면 누가 남아 있는지가 안 읽힌다. 켜고 끄는 물체라 합친 뒤에 넣는다.
   */
  buildDeskLamps() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255, 214, 140, 1)");
    gradient.addColorStop(1, "rgba(255, 214, 140, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const material = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(1.15, 1.15);
    this.deskGlows = new Map();
    for (const desk of this.plan.desks) {
      const glow = new THREE.Mesh(geometry, material);
      glow.rotation.x = -Math.PI / 2;
      // 상판 바로 위 — 모니터·키보드보다 낮아야 그 위로 빛이 번지지 않는다.
      glow.position.copy(this.world(desk.desk.x, desk.desk.y, SCALE.deskTop + 0.004));
      glow.visible = false;
      glow.userData.noOutline = true;
      this.deskGlows.set(desk.agentType, glow);
      this.scene.add(glow);
    }
  }

  /**
   * 로봇청소기와 못 치운 먼지 — 장식이 아니라 "주간 기억 청소가 살아 있는가" 의 신호다(2D 와 같다).
   * 쓰레기통이 평면도에 없으면 설 자리가 없어 만들지 않는다. 움직이는 물체라 합친 뒤에 넣는다.
   */
  buildHousekeeping() {
    this.vacuum = null;
    this.housekeepingKey = null;
    const trash = this.plan.furniture.find((placement) => placement.kind === "trash");
    if (!trash) {
      return;
    }
    const home = this.world(trash.tile.x, trash.tile.y);
    const robot = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.07, 24), mat("cabinetCharcoal"));
    shell.position.y = 0.045;
    shell.castShadow = true;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial());
    led.position.set(0, 0.085, 0.06);
    led.userData.noOutline = true;
    robot.add(shell, led);
    robot.position.set(home.x, 0, home.z + VACUUM.front);
    // 먼지 — 건수만큼 덩이를 더한다. 세 덩이를 넘기지 않는 것은 통보다 커지면 "통이 작다" 로 읽혀서다.
    const dust = [
      [0, 0.06, 0],
      [0.1, 0.05, 0.05],
      [0.04, 0.045, -0.09],
    ].map(([x, radius, z]) => {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), mat("metalDark"));
      blob.scale.y = 0.6;
      blob.position.set(home.x + VACUUM.dustX + x, radius * 0.6, home.z + VACUUM.dustFront + z);
      return blob;
    });
    const holder = new THREE.Group();
    holder.add(robot, ...dust);
    holder.visible = false;
    addOutlines(holder);
    this.scene.add(holder);
    this.vacuum = { holder, robot, led, dust, homeX: home.x };
  }

  /**
   * @param {object|null} housekeeping 스냅샷의 `housekeeping`({ranAt, pendingProjects}).
   *
   * 서버가 이 필드를 모르거나(구버전) 평면도에 판정 기준이 없으면(옛 `layout-*.json`) 그리지 않는다 —
   * 모르는 것을 "청소가 죽었다" 로 그리면 멀쩡한 배포가 고장으로 보인다.
   *
   * 순회는 **따로 그리기를 일으키지 않는다.** 7초에 0.62칸이라 느리고, 걷는 사람이 있는 동안(30fps)과
   * 안전망(1fps)에 얹혀 자리만 옮긴다 — 여기서 움직임을 알리면 멈춘 사무실이 다시 매 프레임 그려진다.
   */
  updateHousekeeping(housekeeping, now) {
    if (!this.vacuum) {
      return;
    }
    const healthyDays = this.metrics.vacuumHealthyIntervalDays;
    const { holder, robot, led, dust, homeX } = this.vacuum;
    holder.visible = Boolean(housekeeping) && typeof healthyDays === "number";
    if (!holder.visible) {
      this.housekeepingKey = null;
      return;
    }
    const ranAt = housekeeping.ranAt ? Date.parse(housekeeping.ranAt) : NaN;
    // 미래 시각(시계 어긋남)은 방금 돈 것으로 본다(`officeVacuumMode` 와 같은 판정).
    const mode = Number.isNaN(ranAt)
      ? "docked"
      : (Date.now() - ranAt) / 86_400_000 <= healthyDays
        ? "sweeping"
        : "stalled";
    const level = Math.max(0, Math.min(housekeeping.pendingProjects ?? 0, this.metrics.trashMaxLevel ?? dust.length));
    led.material.color.set(VACUUM_LED[mode]);
    dust.forEach((blob, index) => {
      blob.visible = index < level;
    });
    // 2D 와 같은 자리 — 순회 중이면 왕복 왼쪽 끝, 멈췄으면 오른쪽 바깥.
    let x = mode === "sweeping" ? -VACUUM.travel / 2 : VACUUM.parkedX;
    if (mode === "sweeping" && !REDUCE_MOTION) {
      const leg = (now / VACUUM.legSeconds) % 2;
      x = (leg < 1 ? leg : 2 - leg) * VACUUM.travel - VACUUM.travel / 2;
    }
    robot.position.x = homeX + x;
    this.housekeepingKey = `${mode}:${level}`;
  }

  zoneAt(x, y) {
    return (this.plan.zones ?? []).find(
      (zone) =>
        x >= zone.origin.x &&
        x < zone.origin.x + zone.width &&
        y >= zone.origin.y &&
        y < zone.origin.y + zone.height
    );
  }

  /** 바닥 — 칸마다 얇은 판 하나. 한 번에 그리려고 인스턴스로 묶고 색만 칸마다 준다. */
  buildFloor() {
    const { columns, rows, floor } = this.plan;
    const tiles = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        if (floor[y][x] !== "wall") {
          tiles.push({ x, y, kind: floor[y][x] });
        } else if (this.touchesFloor(x, y)) {
          // 얇은 벽 양옆에 드러나는 자리 — 복도 색으로 깐다.
          tiles.push({ x, y, kind: "corridor" });
        }
      }
    }
    const geometry = new THREE.BoxGeometry(1, SCALE.floorThickness, 1);
    const mesh = new THREE.InstancedMesh(geometry, mat("floorBase"), tiles.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    tiles.forEach((tile, index) => {
      const position = this.world(tile.x, tile.y, -SCALE.floorThickness / 2);
      matrix.makeTranslation(position.x, position.y, position.z);
      mesh.setMatrixAt(index, matrix);
      color.set(FLOOR_COLORS[tile.kind] ?? FLOOR_COLORS.corridor);
      const zone = this.zoneAt(tile.x, tile.y);
      if (zone && tile.kind !== "corridor") {
        color.lerp(tone(this.layout.departmentColors[zone.department]), FLOOR_TINT);
      }
      // 칸 경계가 읽히도록 한 칸 걸러 아주 조금만 어둡게 — 격자선 대신이다.
      if ((tile.x + tile.y) % 2 === 1) {
        color.multiplyScalar(0.975);
      }
      mesh.setColorAt(index, color);
    });
    mesh.receiveShadow = true;
    // 클릭이 어느 칸에 떨어졌는지 인스턴스 번호로 되찾는다(방 확대).
    mesh.userData.tiles = tiles;
    this.floorMesh = mesh;
    this.scene.add(mesh);
  }

  /**
   * 벽 — 레퍼런스처럼 **뒤쪽 두 면(북·서)만 높게**, 방 사이는 허리 높이, 앞쪽(남·동)은 낮은 턱.
   * 카메라가 남동쪽에서 내려다보므로 높은 벽이 앞에 오면 방을 가린다.
   */
  buildWalls() {
    const { columns, rows } = this.plan;
    const outerRows = this.metrics.outerWallRows ?? 2;
    this.wallHeights = new Map();
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        if (this.isWall(x, y) && this.touchesFloor(x, y)) {
          let height = WALL_MID;
          if (y >= rows - outerRows || x === 0) {
            height = SCALE.wallTall;
          } else if (y === 0 || x === columns - 1) {
            height = SCALE.wallLow;
          }
          this.wallHeights.set(`${x},${y}`, height);
        }
      }
    }
    // 같은 높이로 곧게 이어진 벽 칸을 **한 덩어리**로 세운다. 칸마다 따로 세우면 외곽선이
    // 칸 경계마다 그어져 벽이 벽돌처럼 토막 나 보인다(첫 외곽선 캡처).
    // 둥근 모서리 상자 — 각진 상자는 외곽선이 모서리에서 갈라진다(`character.js` 의 roundedBox 와 같은 이유).
    const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.04);
    const add = (height, fromX, toX, fromZ, toZ) => {
      const wall = new THREE.Mesh(geometry, mat(height === SCALE.wallTall ? "wallCream" : "wallLow"));
      wall.scale.set(toX - fromX, height, toZ - fromZ);
      wall.position.set((fromX + toX) / 2, height / 2, (fromZ + toZ) / 2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    };
    const half = WALL_THICKNESS / 2;
    const heightAt = (x, y) => this.wallHeights.get(`${x},${y}`);
    const covered = new Set();
    for (const horizontal of [true, false]) {
      const [outer, inner] = horizontal ? [rows, columns] : [columns, rows];
      for (let line = 0; line < outer; line += 1) {
        let start = 0;
        while (start < inner) {
          const at = (step) => (horizontal ? [step, line] : [line, step]);
          const height = heightAt(...at(start));
          if (height === undefined) {
            start += 1;
            continue;
          }
          let end = start;
          while (end + 1 < inner && heightAt(...at(end + 1)) === height) {
            end += 1;
          }
          // 한 칸짜리 토막은 반대 방향 줄이 세운다 — 기둥만 남는 칸은 아래에서 따로 세운다.
          if (end > start) {
            // 끝이 **더 높은** 벽과 만나면 그 칸 가운데까지 뻗어 틈을 메운다. 낮은 쪽과
            // 만나면 그쪽 줄이 이쪽으로 뻗어 온다.
            const reach = (step) => {
              const neighbor = heightAt(...at(step));
              return neighbor !== undefined && neighbor > height ? 0.5 : half;
            };
            const [sx, sy] = at(start);
            const [ex, ey] = at(end);
            const from = this.world(sx, sy);
            const to = this.world(ex, ey);
            if (horizontal) {
              add(height, from.x - reach(start - 1), to.x + reach(end + 1), from.z - half, from.z + half);
            } else {
              // 세로 줄은 y 가 커질수록 z 가 작아진다(북쪽 = -z).
              add(height, from.x - half, from.x + half, to.z - reach(end + 1), from.z + reach(start - 1));
            }
            for (let step = start; step <= end; step += 1) {
              covered.add(at(step).join(","));
            }
          }
          start = end + 1;
        }
      }
    }
    // 어느 줄에도 안 속한 외톨이 벽 칸(문 옆 기둥 등).
    for (const [tile, height] of this.wallHeights) {
      if (!covered.has(tile)) {
        const [x, y] = tile.split(",").map(Number);
        const center = this.world(x, y);
        add(height, center.x - half, center.x + half, center.z - half, center.z + half);
      }
    }
    this.buildWindows();
  }

  /** 여덟 이웃 중 바닥이 하나라도 있으면 보이는 벽이다. 벽에 둘러싸인 벽은 그리지 않는다. */
  touchesFloor(x, y) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const kind = this.plan.floor[y + dy]?.[x + dx];
        if (kind !== undefined && kind !== "wall") {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 창·벽등 — 평면도가 정한 벽 칸의 남쪽 면에 붙인다(창은 모두 북쪽 바깥벽에 있다).
   * 창 유리는 시간대 하늘색을 받으므로 팔레트 재질(공유)이 아니라 렌더러 전용 재질을 쓴다 —
   * 공유 재질을 바꾸면 유리 칸막이까지 밤하늘색이 된다.
   */
  buildWindows() {
    const frame = mat("woodLight");
    this.windowGlass = new THREE.MeshBasicMaterial({ color: 0xcfe6ee });
    for (const tile of this.plan.windowTiles ?? []) {
      const face = this.world(tile.x, tile.y);
      face.z += WALL_THICKNESS / 2;
      const outer = new THREE.Mesh(new RoundedBoxGeometry(0.96, 0.7, 0.06, 2, 0.02), frame);
      outer.position.set(face.x, 0.95, face.z + 0.02);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.58, 0.02), this.windowGlass);
      pane.position.set(face.x, 0.95, face.z + 0.05);
      pane.userData.noOutline = true;
      this.scene.add(outer, pane);
    }
    for (const tile of this.plan.wallLampTiles ?? []) {
      const face = this.world(tile.x, tile.y);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), mat("lampWarm"));
      lamp.position.set(face.x, 1.3, face.z + WALL_THICKNESS / 2 + 0.05);
      this.scene.add(lamp);
    }
  }

  buildFurniturePieces() {
    for (const placement of this.plan.furniture) {
      const info = this.layout.furniture[placement.kind] ?? {};
      const footprint = [info.footprintWidth ?? 1, info.footprintHeight ?? 1];
      const piece = buildFurniture(placement.kind, footprint);
      if (!piece) {
        continue;
      }
      const { x, y } = placement.tile;
      if (info.wallMounted) {
        if (!this.hangOnWall(piece, x, y)) {
          continue;
        }
      } else {
        // 두 칸 이상 차지하면 점유 범위 중심에 놓는다(기준 칸은 왼쪽 아래).
        piece.position.set(x + footprint[0] / 2, 0, -(y + footprint[1] / 2));
      }
      this.scene.add(piece);
    }
    // 좌석마다 의자. 2D 에서는 책상 그림에 의자가 들어 있어 평면도에 따로 없다.
    for (const desk of this.plan.desks) {
      const chair = buildFurniture("chairDown");
      chair.position.copy(this.world(desk.seat.x, desk.seat.y));
      this.scene.add(chair);
    }
  }

  /**
   * 벽걸이는 벽 칸 위에 놓여 있다. 맞닿은 바닥 칸 쪽 면에 건다 — 빌더는 등판을
   * `WALL_MOUNT.backZ` 에 만들므로, 원점을 벽 면에서 바닥 쪽으로 그만큼 물린 곳에 두고 -z 가
   * 벽을 향하게 돌린다.
   */
  hangOnWall(piece, x, y) {
    const sides = [
      { dx: 0, dy: -1, rotation: 0 },
      { dx: 1, dy: 0, rotation: Math.PI / 2 },
      { dx: -1, dy: 0, rotation: -Math.PI / 2 },
      { dx: 0, dy: 1, rotation: Math.PI },
    ];
    const side = sides.find(({ dx, dy }) => {
      const kind = this.plan.floor[y + dy]?.[x + dx];
      return kind !== undefined && kind !== "wall";
    });
    if (!side) {
      return false;
    }
    const wallHeight = this.wallHeights.get(`${x},${y}`) ?? WALL_MID;
    const reach = WALL_THICKNESS / 2 - WALL_MOUNT.backZ;
    piece.position.copy(
      this.world(x + side.dx * reach, y + side.dy * reach, Math.max(0.02, Math.min(0.75, wallHeight - WALL_MOUNT.maxHeight)))
    );
    piece.rotation.y = side.rotation;
    return true;
  }

  buildPresident() {
    const tile = this.plan.presidentTile;
    if (!tile) {
      return;
    }
    // 대표는 **서 있다**(2D·맥 앱과 같다). 앞 칸(y-1)은 평면도가 면담 공간으로 비워 둔 통행 칸이라
    // 책상을 놓으면 줄 선 사람이 가려지고 걷는 사람이 책상을 뚫는다 — 평면도에 없는 가구는 만들지 않는다.
    const president = makeCharacter(PRESIDENT_LOOK);
    president.position.copy(this.world(tile.x, tile.y));
    poseCharacter(president, { seated: false, facing: "down", pose: "down" }, 0);
    president.add(this.hitBox({ president: true }));
    this.presidentAlarm = this.overlay.label("office3d-alarm", "🚨");
    this.presidentAlarm.position.set(0, LABEL_HEIGHT + 0.2, 0);
    this.presidentAlarm.visible = false;
    // 대표 이름도 다른 사람과 같은 규칙 — hover 때만. 늘 띄우면 바로 뒤 세션 책상 이름과 겹친다.
    this.presidentName = this.overlay.label("office3d-label", "나 (대표)");
    this.presidentName.position.set(0, LABEL_HEIGHT, 0);
    this.presidentName.visible = false;
    president.add(this.presidentAlarm, this.presidentName);
    this.scene.add(president);
  }

  /** 부서 문패·공용 공간 이름·세션 책상 이름 — 움직이지 않는 글자. */
  buildPlates() {
    // 사람 이름표가 피해 갈 움직이지 않는 글자(`separatePersonLabels`).
    this.plates = [];
    for (const zone of this.plan.zones ?? []) {
      const [icon, label] = this.layout.departmentLabels?.[zone.department] ?? ["", zone.department];
      const plate = this.overlay.label("office3d-plate", `${icon} ${label}`);
      const color = this.layout.departmentColors?.[zone.department];
      if (color) {
        plate.element.style.color = `#${tone(color, 0.1).getHexString()}`;
      }
      // 방 북쪽 벽(허리 높이) 위에 세운다 — 방 안 가구·사람을 가리지 않는 자리.
      plate.position.set(zone.origin.x + zone.width / 2, WALL_MID + 0.22, -(zone.origin.y + zone.height + 0.5));
      this.scene.add(plate);
      this.plates.push(plate);
    }
    const outerRows = this.metrics.outerWallRows ?? 2;
    for (const area of this.plan.commonAreas ?? []) {
      const plate = this.overlay.label("office3d-plate common", `${area.icon} ${area.label}`);
      // 공용 공간은 북쪽 높은 벽의 창 위 — 부서 문패보다 뒤로 물러난 자리.
      plate.position.set(area.originX + area.width / 2, 1.5, -(this.plan.rows - outerRows + 0.5) + WALL_THICKNESS);
      this.scene.add(plate);
      this.plates.push(plate);
    }
    this.sessionLabels = (this.layout.sessionDesks ?? []).map((tile) => {
      const label = this.overlay.label("office3d-session");
      // 책상 **뒤 벽면**에 붙인다. 2D 는 위가 바깥벽이라 책상 아래에 적었지만, 3D 에서 아래는
      // 대표실과 품질 방 사이 복도라 부서 문패와 겹친다(첫 캡처). 3D 의 뒤쪽은 높은 벽이라 빈 면이다.
      label.position.copy(this.world(tile.x, tile.y, 0.78));
      label.position.z -= 0.55;
      label.visible = false;
      this.scene.add(label);
      return label;
    });
  }

  /** 클릭 판정용 보이지 않는 상자. 외곽선·머리카락 조각까지 훑지 않고 이것 하나만 맞힌다. */
  hitBox(userData) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, SCALE.characterHeight, 0.45),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    box.position.y = SCALE.characterHeight / 2;
    box.userData = { ...userData, noOutline: true };
    this.hitTargets.push(box);
    return box;
  }

  // MARK: - 입력

  listen() {
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (event) => {
      this.pointer = this.toPointer(event);
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
    });
    canvas.addEventListener("click", (event) => this.handleClick(this.toPointer(event)));
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      // 한 번에 한 겹씩 — 선택이 있으면 선택만 풀고, 다음 esc 에 방 확대를 푼다.
      if (this.selectedAgent) {
        this.selectedAgent = null;
      } else {
        this.setFocus(null);
      }
    });
  }

  toPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /** 포인터 아래 가장 앞의 것. 사람이 바닥보다 우선이다. */
  pick(pointer) {
    this.raycaster.setFromCamera(pointer, this.camera);
    const person = this.raycaster.intersectObjects(this.hitTargets, false)[0];
    if (person) {
      return person.object.userData;
    }
    const floor = this.raycaster.intersectObject(this.floorMesh, false)[0];
    if (floor && floor.instanceId !== undefined) {
      return { tile: this.floorMesh.userData.tiles[floor.instanceId] };
    }
    return null;
  }

  handleClick(pointer) {
    const target = this.pick(pointer);
    if (target?.agentType) {
      this.selectedAgent = target.agentType;
      this.emit("office:agent-click", { agentType: target.agentType });
      return;
    }
    if (target?.president) {
      this.emit("office:president-click", {});
      return;
    }
    if (this.selectedAgent) {
      // 링만 풀고 끝내면 화면을 얹은 앱(맥 콘솔)의 인스펙터가 열린 채 남는다.
      this.selectedAgent = null;
      this.emit("office:deselect", {});
    }
    const zone = target?.tile ? this.zoneAt(target.tile.x, target.tile.y) : null;
    // 방을 누르면 그 방으로, 방 밖(복도·공용 공간·배경)을 누르면 전체로.
    this.setFocus(zone && zone.department !== this.focusDepartment ? zone.department : zone ? this.focusDepartment : null);
  }

  emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // MARK: - 카메라

  setFocus(department) {
    if (department === this.focusDepartment) {
      return;
    }
    this.focusDepartment = department;
    this.tween = {
      from: { ...this.viewBounds },
      to: this.focusBounds(),
      startedAt: performance.now(),
    };
    this.emit("office:focus", { department });
  }

  /** 카메라가 담을 범위(평면도 칸 단위). 방 확대면 그 방과 둘레 벽 한 칸. */
  focusBounds() {
    const zone = (this.plan.zones ?? []).find((entry) => entry.department === this.focusDepartment);
    if (zone) {
      return {
        minX: zone.origin.x - 1,
        maxX: zone.origin.x + zone.width + 1,
        minY: zone.origin.y - 1,
        maxY: zone.origin.y + zone.height + 1,
      };
    }
    return { minX: 0, maxX: this.plan.columns, minY: 0, maxY: this.plan.rows };
  }

  /** 캔버스 크기가 바뀌었다 — 백버퍼·겹침층을 맞추고 지금 범위로 카메라를 다시 잡는다. */
  measure() {
    this.webgl.setSize(this.canvas.width, this.canvas.height, false);
    this.overlay.place(this.canvas);
    this.applyCamera(this.viewBounds);
  }

  /**
   * 범위의 모서리 여덟 개를 카메라 좌표로 옮겨, 그것이 다 들어가는 가장 작은 직교 범위를 쓴다.
   */
  applyCamera(bounds) {
    // 카메라가 바뀌면 바뀐 것이 없어도 다음 프레임을 그려야 한다. 카메라를 만지는 길이 전부 여기를
    // 지나므로(`measure` — 백버퍼 크기를 바꿔 그림이 지워진다 — 와 방 확대 전환) 여기 한 곳에 둔다.
    this.dirty = true;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const { left, right, bottom, top, halfWidth, halfHeight } = frameBounds(this.camera, bounds, width, height);
    const midX = (left + right) / 2;
    const midY = (bottom + top) / 2;
    this.camera.left = midX - halfWidth;
    this.camera.right = midX + halfWidth;
    this.camera.top = midY + halfHeight;
    this.camera.bottom = midY - halfHeight;
    this.camera.updateProjectionMatrix();
    // 상태 줄이 "타일 N px" 를 찍는다 — 화면 폭 대비 타일 한 칸의 대략적인 크기.
    const pixelRatio = window.devicePixelRatio || 1;
    this.tileSize = width / pixelRatio / (halfWidth * 2);
    setOutlineWidth(OUTLINE.pixels / this.tileSize);
  }

  /** 방 확대 전환 — 범위를 부드럽게 옮긴다. 끝나면 null. */
  stepTween(now) {
    if (!this.tween) {
      return;
    }
    const progress = Math.min(1, (now - this.tween.startedAt) / 1000 / CAMERA.focusSeconds);
    const eased = 1 - (1 - progress) ** 3;
    const { from, to } = this.tween;
    this.viewBounds = Object.fromEntries(
      Object.keys(to).map((key) => [key, from[key] + (to[key] - from[key]) * eased])
    );
    this.applyCamera(this.viewBounds);
    if (progress >= 1) {
      this.tween = null;
    }
  }

  // MARK: - 시간대

  /**
   * 창밖 빛 — 평면도의 `daylight` 띠(새벽·아침·낮·저녁·밤)를 그대로 쓴다. 2D 와 같은 띠라 두
   * 화면이 같은 시각에 같은 분위기다. 해·하늘빛 세기는 띠의 `glowStrength` 로 누르고, 밤에는
   * 벽등이 켜진다(`lampLit`).
   */
  applyDaylight(hour) {
    const normalized = ((Math.floor(hour) % 24) + 24) % 24;
    if (normalized === this.lightHour) {
      return;
    }
    this.lightHour = normalized;
    this.lampLit = false;
    const band =
      Object.values(this.layout.daylight ?? {}).find((info) => info.hours.includes(normalized)) ??
      this.layout.daylight?.day;
    if (!band) {
      return;
    }
    const strength = THREE.MathUtils.clamp(0.45 + band.glowStrength * 2.6, 0.5, 1);
    const { hemisphere, sun, fill, base } = this.lights;
    hemisphere.intensity = base.hemisphere * strength;
    sun.intensity = base.sun * strength;
    fill.intensity = base.fill * Math.max(0.7, strength);
    const glow = new THREE.Color().setRGB(...band.glow, THREE.SRGBColorSpace);
    sun.color.set(0xfff1dc).lerp(glow, 0.5);
    const sky = new THREE.Color().setRGB(...band.skyHigh, THREE.SRGBColorSpace);
    this.scene.background.set(BACKGROUND).lerp(sky, (1 - strength) * 0.7);
    this.windowGlass.color.setRGB(...band.skyLow, THREE.SRGBColorSpace);
    const lamp = mat("lampWarm");
    lamp.emissive.set(band.lampLit ? 0xffc46b : 0x000000);
    lamp.emissiveIntensity = band.lampLit ? 1.2 : 0;
    this.lampLit = Boolean(band.lampLit);
  }

  // MARK: - 한 판 그리기

  /** @param {object} view live.js 가 주는 것 — `agents`·`bodies`·`now` 등(office.js 와 같다). */
  draw(view) {
    const frameAt = performance.now();
    // 전환의 마지막 걸음은 `stepTween` 이 `tween` 을 비운다 — 그 프레임도 그려야 하므로 먼저 본다.
    const tweening = Boolean(this.tween);
    this.stepTween(frameAt);
    this.applyDaylight(view.hour ?? 12);
    // 출근 지연 중이라 문 앞에서 기다리는 사람은 그리지 않는다(`office.js` 와 같은 규칙).
    const bodies = Object.fromEntries(
      Object.entries(view.bodies ?? {}).filter(([, body]) => !body.hidden)
    );
    for (const [agentType, entry] of this.characters) {
      if (!bodies[agentType]) {
        this.scene.remove(entry.figure, entry.ring);
        this.hitTargets = this.hitTargets.filter((target) => target.parent !== entry.figure);
        this.characters.delete(agentType);
      }
    }
    const hovered = this.pointer ? this.pick(this.pointer) : null;
    this.hoveredAgent = hovered?.agentType ?? null;
    this.canvas.style.cursor = this.hoveredAgent || hovered?.president ? "pointer" : "";
    if (this.presidentName) {
      this.presidentName.visible = Boolean(hovered?.president);
    }
    for (const [agentType, glow] of this.deskGlows) {
      const body = bodies[agentType];
      const seat = this.seatsByAgent.get(agentType);
      glow.visible = Boolean(this.lampLit && body?.seated && body.x === seat.x && body.y === seat.y);
    }
    for (const [agentType, body] of Object.entries(bodies)) {
      const entry = this.characterEntry(agentType);
      const offset = seatOffset(body);
      const position = this.world(body.x + offset.x, body.y + offset.y);
      entry.figure.position.copy(position);
      // 내가 방금 보낸 지시의 단계가 있으면 그쪽이 우선한다(2D `applyMotion`) — 지금 눈으로 좇는 대상이다.
      const phase = view.pending?.[agentType];
      const slump = phase ? phase === "failed" : view.agents?.[agentType]?.state === "FAILED";
      poseCharacter(entry.figure, body, view.now ?? 0, { slump });
      this.updateRing(entry, agentType, view, position);
      this.updateLabels(entry, agentType, view, body);
    }
    this.updateSessions(view.sessions ?? []);
    this.updateHousekeeping(view.housekeeping ?? null, view.now ?? 0);
    if (this.presidentAlarm) {
      this.presidentAlarm.visible = Boolean(view.presidentAlarm);
    }
    const hud = this.summaryText(view.summary);
    this.overlay.setHud(hud);
    // 위에서 옮긴 자세·글자는 그리지 않아도 장면에 남는다 — 건너뛴 프레임의 변화는 다음에 그릴 때 함께 나온다.
    const { signature, moving } = frameSignature({
      scene: [
        this.hoveredAgent,
        Boolean(hovered?.president),
        this.selectedAgent,
        this.lightHour,
        Boolean(view.presidentAlarm),
        hud,
        this.housekeepingKey,
      ],
      bodies,
      agents: view.agents,
      sessions: view.sessions,
      pending: view.pending,
    });
    const render = shouldRender({
      changed: this.dirty || signature !== this.renderedSignature,
      smooth: tweening,
      moving,
      elapsedMs: frameAt - (this.renderedAt ?? -Infinity),
    });
    if (!render) {
      return;
    }
    this.dirty = false;
    this.renderedSignature = signature;
    this.renderedAt = frameAt;
    this.webgl.render(this.scene, this.camera);
    this.overlay.render(this.scene, this.camera);
    this.separatePersonLabels();
  }

  /**
   * 사람 이름표(+말풍선)가 서로·문패와 포개지면 뒤에 선 사람의 판을 가장 가까운 빈 자리로 옮긴다(`label-separation.js`).
   *
   * 회의석은 한 칸 간격이라 넷이 모이면 이름표가 한 덩어리로 겹쳐 아무 이름도 안 읽혔다. 위치는
   * CSS2DRenderer 가 방금 정했으므로, 같은 투영으로 화면 좌표를 다시 재고 **비킬 양만** `translate` 로
   * 얹는다 — 렌더러가 매 프레임 덮어쓰는 `transform` 과 따로 합쳐지는 속성이라 서로 지우지 않는다.
   */
  separatePersonLabels() {
    const { width, height } = this.overlay.css.getSize();
    const point = new THREE.Vector3();
    const screen = (object) => {
      point.setFromMatrixPosition(object.matrixWorld).project(this.camera);
      return { x: (point.x * 0.5 + 0.5) * width, y: (-point.y * 0.5 + 0.5) * height };
    };
    const rect = (object, raise = 0) => {
      const { x, y } = screen(object);
      const element = object.element;
      const center = y - raise;
      return {
        left: x - element.offsetWidth / 2,
        right: x + element.offsetWidth / 2,
        top: center - element.offsetHeight / 2,
        bottom: center + element.offsetHeight / 2,
      };
    };
    const labels = [];
    for (const [agentType, entry] of this.characters) {
      if (!entry.name.visible) {
        continue;
      }
      const box = rect(entry.name);
      if (entry.bubble.visible) {
        const dots = entry.bubble.element.classList.contains("office3d-dots");
        const bubble = rect(entry.bubble, dots ? DOTS_RAISE_PX : BUBBLE_RAISE_PX);
        box.left = Math.min(box.left, bubble.left);
        box.right = Math.max(box.right, bubble.right);
        box.top = Math.min(box.top, bubble.top);
      }
      labels.push({ key: agentType, ...box });
    }
    const obstacles = this.plates.filter((plate) => plate.visible).map((plate) => rect(plate));
    const offsets = separateLabels(labels, obstacles, LABEL_GAP_PX);
    for (const [agentType, entry] of this.characters) {
      const offset = offsets.get(agentType);
      const translate =
        offset && (offset.dx !== 0 || offset.dy !== 0)
          ? `${Math.round(offset.dx)}px ${Math.round(offset.dy)}px`
          : "";
      for (const element of [entry.name.element, entry.bubble.element]) {
        if (element.style.translate !== translate) {
          element.style.translate = translate;
        }
      }
    }
  }

  characterEntry(agentType) {
    let entry = this.characters.get(agentType);
    if (!entry) {
      const look = this.layout.agentLooks?.[agentType] ?? FALLBACK_LOOK;
      const figure = makeCharacter(look);
      figure.add(this.hitBox({ agentType }));
      const name = this.overlay.label("office3d-label");
      const bubble = this.overlay.label("office3d-bubble");
      figure.add(name, bubble);
      entry = { figure, ring: makeStatusRing(), name, bubble, look };
      this.scene.add(figure, entry.ring);
      this.characters.set(agentType, entry);
    }
    return entry;
  }

  updateRing(entry, agentType, view, position) {
    const state = view.agents?.[agentType]?.state;
    const color = state ? this.layout.stateColors?.[state] : null;
    const selected = agentType === this.selectedAgent;
    entry.ring.visible = Boolean(color) || selected;
    if (color) {
      entry.ring.material.color.setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace);
    } else if (selected) {
      entry.ring.material.color.set(0xffffff);
    }
    // 선택한 사람은 링을 키워 어느 사람이 인스펙터에 떠 있는지 화면에서도 짚이게 한다.
    entry.ring.scale.setScalar(selected ? 1.35 : 1);
    entry.ring.position.set(position.x, 0.012, position.z);
  }

  updateLabels(entry, agentType, view, body) {
    const agent = view.agents?.[agentType];
    const state = agent?.state ?? "WAITING";
    const focused = agentType === this.hoveredAgent || agentType === this.selectedAgent;
    const named = focused || NAMED_STATES.has(state);
    const name = entry.look.roleLabel ?? agent?.nickname ?? agent?.displayName ?? agentType;
    // hover·선택이면 이름 옆에 상태와 하는 일까지 — 이것이 툴팁이다.
    const text = focused
      ? [name, STATE_LABELS[state] ?? state, agent?.job].filter(Boolean).join(" · ")
      : name;
    const className = ALERT_STATES.has(state)
      ? "office3d-label alert"
      : named
        ? "office3d-label"
        : "office3d-label idle";
    Overlay3D.set(entry.name, text, className);
    entry.name.visible = true;
    entry.name.position.set(0, LABEL_HEIGHT, 0);
    // 머리 위 한 자리를 셋이 나눠 쓴다 — 잠깐 뜨는 말풍선(거절 `!`)이 먼저, 다음이 하는 일, 둘 다 없고
    // 지시가 접수만 된 상태면 점.
    const bubbleText = body.flash ?? (showsBubble(state) ? agent?.bubble : null);
    const dots = !bubbleText && view.pending?.[agentType] === "sent";
    entry.bubble.visible = Boolean(bubbleText) || dots;
    if (entry.bubble.visible) {
      // 이름표가 늘 떠 있으므로 말풍선은 늘 그 위로 올린다.
      Overlay3D.set(entry.bubble, dots ? "" : bubbleText, dots ? "office3d-dots" : "office3d-bubble raised");
      entry.bubble.position.set(0, LABEL_HEIGHT, 0);
    }
  }

  updateSessions(sessions) {
    // 세션 이름은 디렉터리명이라 길다. 책상 두 칸 폭을 넘기면 옆 책상·부서 문패와 겹친다
    // (첫 캡처에서 "품질" 문패를 덮었다) — 폭을 화면 배율에 묶고 넘치면 말줄임표로 자른다.
    const maxWidth = `${Math.round(this.tileSize * 1.9)}px`;
    this.sessionLabels.forEach((label, index) => {
      if (label.element.style.maxWidth !== maxWidth) {
        label.element.style.maxWidth = maxWidth;
      }
      const session = sessions[index];
      label.visible = Boolean(session);
      if (session) {
        Overlay3D.set(label, session.label, session.active ? "office3d-session active" : "office3d-session");
      }
    });
  }

  summaryText(summary) {
    if (!summary) {
      return "";
    }
    let text = `진행 ${summary.inProgress} · 승인 ${summary.awaitingApproval} · 쉬는 중 ${summary.waiting}`;
    if (summary.sessions > 0) {
      // 대표 앞 세션 책상은 넷뿐이라, 그 수가 곧 전체라고 오해하지 않게 총계를 적는다.
      text += ` · 내 세션 ${summary.sessions}(도는 중 ${summary.activeSessions})`;
    }
    return text;
  }
}
