// 스타일 게이트 — 가구 빌더가 그림체 규칙(`three/style.js`)을 지키는지 코드로 확인한다.
//
// 산문으로 "팔레트만 써라" 고 적어 두면 지켜진 회차에만 지켜진다. 가구를 여러 사람(또는
// 모델)이 나눠 만들수록 한 번 어긋난 색·크기가 화면 전체의 톤을 깬다. 여기서 막는다.
//
//   pnpm check:style
//
// 브라우저 없이 node 로 돈다 — three.js 의 도형·경계 상자 계산은 WebGL 이 필요 없다.
import assert from "node:assert/strict";
import * as THREE from "three";
import { existsSync, readFileSync } from "node:fs";
import { BUILDERS, buildFurniture, missingKinds } from "./three/furniture3d/index.js";
import * as sharedWallArt from "./three/furniture3d/wallArt.js";
import { PALETTE, WALL_MOUNT } from "./three/style.js";
import {
  SHIRT_SKIN_MIN_DISTANCE,
  distinctShirt,
  makeCharacter,
  seatOffset,
  shirtSkinDistance,
} from "./three/character.js";
import { Office3DRenderer } from "./three/renderer3d.js";
import { COZY_LOOKS, cozyLookFor } from "./three/cozy-looks.js";
import { azimuthFor } from "./three/renderer3d.js";

/** 부품 수 상한 — 이보다 많으면 레퍼런스의 뭉툭한 톤을 벗어나 잔손질이 된다. */
const MAX_PARTS = 24;
/** 경계 상자 허용 오차(타일). 둥근 모서리 계산의 부동소수 몫이다. */
const EPSILON = 0.001;

const failures = [];
let checked = 0;
for (const [kind, builder] of Object.entries(BUILDERS)) {
  const { footprint, height } = builder.spec;
  const group = buildFurniture(kind, footprint);
  let parts = 0;
  group.traverse((node) => {
    if (!node.isMesh || node.userData.isOutline) {
      return;
    }
    parts += 1;
    const key = node.material.userData.paletteKey;
    if (!(key in PALETTE)) {
      failures.push(`${kind}: 팔레트 밖 재질(${key ?? "직접 만든 재질"})`);
    }
  });
  if (parts === 0 || parts > MAX_PARTS) {
    failures.push(`${kind}: 부품 ${parts}개 (1~${MAX_PARTS})`);
  }
  const box = new THREE.Box3().setFromObject(group);
  const [width, depth] = footprint;
  if (box.min.x < -width / 2 - EPSILON || box.max.x > width / 2 + EPSILON) {
    failures.push(`${kind}: 가로 ${box.min.x.toFixed(3)}~${box.max.x.toFixed(3)} 가 점유 폭 ${width} 을 넘는다`);
  }
  if (box.min.z < -depth / 2 - EPSILON || box.max.z > depth / 2 + EPSILON) {
    failures.push(`${kind}: 깊이 ${box.min.z.toFixed(3)}~${box.max.z.toFixed(3)} 가 점유 깊이 ${depth} 을 넘는다`);
  }
  if (box.min.y < -EPSILON) {
    failures.push(`${kind}: 바닥 아래로 ${box.min.y.toFixed(3)} 내려간다`);
  }
  if (box.max.y > height + EPSILON) {
    failures.push(`${kind}: 높이 ${box.max.y.toFixed(3)} 가 선언 ${height} 을 넘는다`);
  }
  // 벽걸이 — 등판이 벽면(backZ)에 붙고 방 안으로 maxDepth 까지만. 어기면 벽을 뚫거나 공중에 뜬다.
  if (builder.spec.wall) {
    const { backZ, maxDepth, maxHeight, maxWidth } = WALL_MOUNT;
    if (Math.abs(box.min.z - backZ) > 0.01 || box.max.z > backZ + maxDepth + EPSILON) {
      failures.push(`${kind}: 벽걸이 깊이 ${box.min.z.toFixed(3)}~${box.max.z.toFixed(3)} (등판 ${backZ}, 최대 ${backZ + maxDepth})`);
    }
    if (box.max.y > maxHeight + EPSILON || box.max.x - box.min.x > maxWidth + EPSILON) {
      failures.push(`${kind}: 벽걸이 크기 폭 ${(box.max.x - box.min.x).toFixed(3)}·높이 ${box.max.y.toFixed(3)} (한도 ${maxWidth}·${maxHeight})`);
    }
  }
  checked += 1;
}

// 캐릭터 — cozy 원화 21종(직원 20 + 정비사)과, 원화 번호가 없는 옛 평면도의 시트 다섯 종. 옷·머리 색은 사람마다 달라 팔레트 밖에서 들어오지만, 그때도
// 반드시 `toneMat`(톤 보정 문)을 거쳐야 한다. 직접 만든 재질은 톤 보정을 건너뛴 것이다.
const characterLooks = [
  ...COZY_LOOKS.map((_, index) => ({ cozyAsset: index })),
  { cozyAsset: -1 },
  ...["char", "charb", "charc", "chard", "chare"].map((sheet) => ({ sheet, shirt: [0.9, 0.5, 0.4], pants: [0.2, 0.2, 0.3], hair: [0.3, 0.2, 0.1] })),
];
for (const look of characterLooks) {
  const sheet = look.sheet ?? `cozy ${look.cozyAsset}`;
  const figure = makeCharacter(look);
  figure.traverse((node) => {
    if (!node.isMesh || node.userData.isOutline) {
      return;
    }
    const key = node.material.userData.paletteKey ?? "";
    if (!(key in PALETTE) && !key.startsWith("tone:")) {
      failures.push(`캐릭터 ${sheet}: 톤 보정을 거치지 않은 재질(${key || "직접 만든 재질"})`);
    }
  });
  const box = new THREE.Box3().setFromObject(figure, true);
  if (Math.abs(box.max.y - 0.92) > 0.05) {
    failures.push(`캐릭터 ${sheet}: 키 ${box.max.y.toFixed(3)} 가 기준 0.92 에서 벗어난다`);
  }
  checked += 1;
}

// 카메라 방위 — 가로로 넓은 창은 확정 각(32°), 정사각형 이하는 15°, 사이는 선형. 높이 0 도 터지지 않아야 한다.
const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;
for (const [width, height, expected] of [
  [1500, 1000, 32],
  [1920, 1080, 32],
  [1000, 1000, 15],
  [900, 1200, 15],
  [1250, 1000, 23.5],
  [1000, 0, 32],
]) {
  const actual = azimuthFor(width, height);
  if (!near(actual, expected)) {
    failures.push(`방위 ${width}×${height}: ${actual} (기대 ${expected})`);
  }
}

// 원화 번호 — 표 안은 그 번호, 정비사(-1)는 정비사, 표 밖은 접지 않고 시트 대체로.
const warn = console.warn;
console.warn = () => {};
if (cozyLookFor({ cozyAsset: 3 }) !== COZY_LOOKS[3]) {
  failures.push("원화 3 이 표의 3 이 아니다");
}
if (cozyLookFor({ cozyAsset: COZY_LOOKS.length, sheet: "charc" }) === COZY_LOOKS[0]) {
  failures.push("표 밖 번호가 0 번 직원으로 접혔다 — 다른 사람 얼굴이 된다");
}
if (cozyLookFor({ cozyAsset: -7 }) === cozyLookFor({ cozyAsset: -1 })) {
  failures.push("손상된 음수가 정비사로 그려진다");
}
for (const asset of [COZY_LOOKS.length, -7, 2.5, undefined]) {
  if (!cozyLookFor({ cozyAsset: asset, sheet: "char" })?.hair) {
    failures.push(`원화 번호 ${asset}: 생김새를 못 돌려준다`);
  }
}
console.warn = warn;

// `--require-all` — 평면도에 나오는 가구가 전부 제 빌더를 가졌는지. 빌더가 없으면 자리 표시
// 상자로, 벽걸이가 공용 액자(`wallArt`)를 쓰면 전부 같은 그림으로 그려진다 — 둘 다 미완성이다.
if (process.argv.includes("--require-all")) {
  const kinds = ["layout-3.json", "layout-2.json"]
    .filter((name) => existsSync(name))
    .flatMap((name) => JSON.parse(readFileSync(name, "utf8")).plan.furniture.map((entry) => entry.kind));
  if (kinds.length === 0) {
    failures.push("--require-all: layout-*.json 이 없어 평면도 가구 목록을 모른다");
  }
  for (const kind of missingKinds(kinds)) {
    failures.push(`${kind}: 빌더 없음(자리 표시 상자로 그려진다)`);
  }
  for (const kind of new Set(kinds)) {
    if (BUILDERS[kind] === sharedWallArt) {
      failures.push(`${kind}: 공용 액자(wallArt)를 쓴다 — 종류별 벽걸이 빌더가 필요하다`);
    }
  }
}

// 소파 착석 — 좌석은 소파 앞 칸이고 사람은 소파를 바라본다(`facing`). 몸은 **그 방향으로** 옮겨야
// 소파 위에 앉는다. 부호가 뒤집히면 소파 반대편 바닥에 앉는데, 그림으로는 "허공에 앉음" 과 같은 버그다.
const shifts = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};
for (const [facing, [x, y]] of Object.entries(shifts)) {
  const offset = seatOffset({ seated: true, interactionPose: "sitting", facing });
  if (Math.sign(offset.x) !== x || Math.sign(offset.y) !== y) {
    failures.push(`소파 착석 ${facing}: 몸이 (${offset.x}, ${offset.y}) 로 옮겨진다 — 소파 쪽이 아니다`);
  }
}
for (const body of [
  { seated: true, interactionPose: null, facing: "up" },
  { seated: false, interactionPose: "sitting", facing: "up" },
  { seated: false, interactionPose: null, facing: "left" },
]) {
  const offset = seatOffset(body);
  if (offset.x !== 0 || offset.y !== 0) {
    failures.push(`소파 착석이 아닌데 몸을 옮긴다: ${JSON.stringify(body)}`);
  }
}

// 셔츠와 피부 — 평면도의 모든 셔츠가 칠해진 뒤에도 피부와 갈려야 한다. 피부와 다른 색조(흰·회·파랑)는
// 손대지 않아야 한다 — 누르면 흰 셔츠가 회색이 된다.
const shirts = ["layout-3.json", "layout-2.json"]
  .filter((name) => existsSync(name))
  .flatMap((name) => Object.values(JSON.parse(readFileSync(name, "utf8")).agentLooks ?? {}))
  .map((look) => look.shirt)
  // 평면도가 없어도 대표 난색 몇 개로 잰다(콘텐츠·자산 부서 실측값).
  .concat([
    [0.97, 0.78, 0.72],
    [0.98, 0.82, 0.78],
    [0.97, 0.73, 0.67],
    [0.91, 0.79, 0.58],
  ]);
for (const shirt of shirts) {
  const [red, green, blue] = shirt;
  const warm = red > green && green > blue;
  const adjusted = distinctShirt(shirt);
  if (warm && shirtSkinDistance(adjusted) < SHIRT_SKIN_MIN_DISTANCE) {
    failures.push(`셔츠 ${shirt}: 칠한 뒤 피부와 거리 ${shirtSkinDistance(adjusted).toFixed(3)}`);
  }
  if (!warm && adjusted !== shirt) {
    failures.push(`셔츠 ${shirt}: 피부와 다른 색조인데 색을 바꿨다`);
  }
}

// 배치 고르기 — live.js `chooseZoneColumns` 는 3D 에서 2열이 3열보다 **5% 넘게** 클 때만 2열을 쓴다.
// 세로로 긴 창(사용자 창 1083×752 가 그랬다)은 그 문턱을 넘어야 하고, 넓은 창은 넘지 않아야 한다 —
// 넓은 창까지 2열로 바뀌면 몇 % 를 얻자고 익숙한 배치가 통째로 바뀐다.
const threeColumns = { columns: 35, rows: 20 };
const twoColumns = { columns: 23, rows: 27 };
for (const [width, height, prefersTwo] of [
  [1083, 752, true],
  [1107, 1100, true],
  [1400, 820, false],
  [2400, 900, false],
]) {
  const ratio =
    Office3DRenderer.tileSizeFor(twoColumns, width, height) /
    Office3DRenderer.tileSizeFor(threeColumns, width, height);
  if (ratio > 1.05 !== prefersTwo) {
    failures.push(`${width}×${height}: 2열/3열 = ${ratio.toFixed(3)} — ${prefersTwo ? "2열" : "3열"}이어야 한다`);
  }
}

// 게이트 자신이 무너지지 않았는지 — 팔레트 밖 재질을 일부러 넣은 가구는 걸려야 한다.
const rogue = new THREE.Group();
rogue.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
let rogueCaught = false;
rogue.traverse((node) => {
  if (node.isMesh && !(node.material.userData.paletteKey in PALETTE)) {
    rogueCaught = true;
  }
});
assert.ok(rogueCaught, "게이트가 팔레트 밖 재질을 못 잡는다");

if (failures.length > 0) {
  console.error(failures.map((line) => `✗ ${line}`).join("\n"));
  process.exit(1);
}
console.log(`스타일 게이트 통과 — 가구·캐릭터 ${checked}종`);
