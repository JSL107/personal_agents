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
import { PALETTE, WALL_MOUNT, SCALE, artMat } from "./three/style.js";
import {
  SHIRT_SKIN_MIN_DISTANCE,
  distinctShirt,
  makeCharacter,
  poseCharacter,
  seatOffset,
  shirtSkinDistance,
} from "./three/character.js";
import { Office3DRenderer } from "./three/renderer3d.js";
import { COZY_LOOKS, PRESIDENT_COZY_LOOK, cozyLookFor } from "./three/cozy-looks.js";
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
  { sheet: "president", cozy: PRESIDENT_COZY_LOOK },
  ...["char", "charb", "charc", "chard", "chare"].map((sheet) => ({ sheet, shirt: [0.9, 0.5, 0.4], pants: [0.2, 0.2, 0.3], hair: [0.3, 0.2, 0.1] })),
];
const characterCosts = [];
const faceRatios = [];
const characterSource = readFileSync(new URL("./three/character.js", import.meta.url), "utf8");
assert.ok(!/from\s+["']three\/addons\//.test(characterSource), "캐릭터는 브라우저에 없는 three/addons 모듈을 import 하면 안 된다");
for (const name of ["face-open", "face-soft"]) {
  const material = artMat(name);
  assert.equal(material, artMat(name), "표정별 재질은 공유해야 한다");
  assert.equal(material.map, null, "Node에서 텍스처를 읽으면 안 된다");
  assert.equal(material.userData.paletteKey, `art:${name}`);
  const png = readFileSync(new URL(`./three/textures/${name}.png`, import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.readUInt32BE(16) <= 512 && png.readUInt32BE(20) <= 512, "얼굴 데칼은 512px 이하");
  assert.equal(png[25], 6, "얼굴 데칼에는 RGBA 투명 채널이 필요하다");
}
for (const look of characterLooks) {
  const sheet = look.sheet ?? `cozy ${look.cozyAsset}`;
  const figure = makeCharacter(look);
  const cost = { sheet, meshes: 0, shadows: 0, triangles: 0 };
  figure.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    // 숨긴 서류와 외곽선도 포함: 자세 전환으로 보이게 되어도 비용 상한을 지킨다.
    cost.meshes += 1;
    cost.shadows += Number(node.castShadow);
    cost.triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    if (node.userData.isOutline) {
      return;
    }
    const key = node.material.userData.paletteKey ?? "";
    if (!(key in PALETTE) && !key.startsWith("tone:") && !key.startsWith("art:")) {
      failures.push(`캐릭터 ${sheet}: 톤 보정을 거치지 않은 재질(${key || "직접 만든 재질"})`);
    }
    if (key.startsWith("art:") && (!node.userData.noOutline || node.userData.hasOutline)) {
      failures.push(`캐릭터 ${sheet}: 얼굴 데칼에 외곽선이 있다`);
    }
    if (key.startsWith("art:")) {
      // 볼을 넓힌 뒤에도 동일한 UV 길이가 같은 x/y 길이에 대응해야 눈이 늘어나지 않는다.
      const position = node.geometry.attributes.position;
      const coordinates = node.geometry.attributes.uv;
      const lengths = ["x", "y"].map((axis) => {
        const values = [];
        const textureValues = [];
        for (let index = 0; index < position.count; index += 1) {
          values.push((axis === "x" ? position.getX(index) : position.getY(index)) * node.scale[axis]);
          textureValues.push(axis === "x" ? coordinates.getX(index) : coordinates.getY(index));
        }
        return (Math.max(...values) - Math.min(...values)) /
          (Math.max(...textureValues) - Math.min(...textureValues));
      });
      assert.ok(lengths.every(Number.isFinite) && Math.abs(lengths[0] - lengths[1]) < 0.00001,
        `${sheet}: 얼굴 데칼의 가로·세로 배율이 다르다`);
    }
  });
  for (const [metric, maximum] of [["meshes", 80], ["shadows", 30], ["triangles", 8000]]) {
    if (cost[metric] > maximum) {
      failures.push(`캐릭터 ${sheet}: ${metric} ${cost[metric]} (상한 ${maximum})`);
    }
  }
  if (look.cozyAsset !== undefined) {
    characterCosts.push(cost);
  }
  const box = new THREE.Box3().setFromObject(figure, true);
  if (Math.abs(box.max.y - 0.92) > 0.05) {
    failures.push(`캐릭터 ${sheet}: 키 ${box.max.y.toFixed(3)} 가 기준 0.92 에서 벗어난다`);
  }
  const { body, legs, arms, head, papers } = figure.userData;
  assert.equal(legs.length, 2);
  assert.equal(arms.length, 2);
  const standing = { seated: false, facing: "down", pose: "down" };
  poseCharacter(figure, standing, 0);
  figure.updateMatrixWorld(true);
  const faces = [];
  figure.traverse((node) => {
    if (node.isMesh && node.userData.characterPart === "face") {
      faces.push(node);
    }
  });
  if (faces.length !== 1) {
    failures.push(`캐릭터 ${sheet}: 얼굴 메시 ${faces.length}개 (정확히 1개 필요)`);
  } else {
    const position = faces[0].geometry.attributes.position;
    const vertex = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(faces[0].matrixWorld);
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      minY = Math.min(minY, vertex.y);
      maxY = Math.max(maxY, vertex.y);
    }
    const ratio = (maxX - minX) / (maxY - minY);
    if (look.cozyAsset !== undefined) {
      faceRatios.push(ratio);
    }
    if (!Number.isFinite(ratio) || ratio < 1.05) {
      failures.push(`캐릭터 ${sheet}: 얼굴 폭÷높이 ${ratio.toFixed(3)} (최소 1.05)`);
    }
  }
  const headHome = head.position.clone();
  for (const [interactionPose, seat] of [[null, SCALE.chairSeat], ["sitting", SCALE.sofaSeat]]) {
    poseCharacter(figure, { ...standing, seated: true, interactionPose }, 0);
    figure.updateMatrixWorld(true);
    for (const leg of legs) {
      assert.equal(leg.hip.rotation.x, -Math.PI / 2);
      assert.equal(leg.knee.rotation.x, Math.PI / 2);
      assert.ok(Math.abs(leg.hip.getWorldPosition(new THREE.Vector3()).y - seat - 0.03) < EPSILON,
        `${sheet}: 착석 엉덩이 피벗이 좌판에 맞지 않는다`);
      assert.ok(new THREE.Box3().setFromObject(leg.knee, true).min.y >= -EPSILON,
        `${sheet}: 착석 발이 바닥 아래로 내려간다`);
    }
  }
  poseCharacter(figure, { ...standing, pose: "down-walk1" }, 0.1);
  assert.ok(legs[0].hip.rotation.x * legs[1].hip.rotation.x < 0, `${sheet}: 걷기 좌우 다리 교대`);
  poseCharacter(figure, { ...standing, pressure: 2 }, 0, { slump: true });
  assert.ok(papers.visible && head.rotation.x > 0, `${sheet}: 서류·실패 자세`);
  poseCharacter(figure, { ...standing, cue: "pulse", cueSeconds: 1, cueRemaining: 0.5 }, 0);
  assert.ok(figure.scale.x > 1, `${sheet}: pulse 몸짓`);
  poseCharacter(figure, standing, 0);
  assert.ok(!papers.visible && head.position.equals(headHome) && figure.scale.x === 1,
    `${sheet}: 평상시 복귀`);
  assert.ok(legs.every((leg) => leg.hip.rotation.x === 0 && leg.knee.rotation.x === 0));
  assert.equal(body.position.y, 0);
  checked += 1;
}
console.log(`원화 21종 비용: ${["meshes", "shadows", "triangles"].map((metric) => {
  const values = characterCosts.map((cost) => cost[metric]);
  return `${metric} 평균 ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)} 최대 ${Math.max(...values)}`;
}).join(" / ")}`);
if (faceRatios.length > 0) {
  console.log(`원화 21종 얼굴 폭÷높이: 평균 ${(faceRatios.reduce((sum, ratio) => sum + ratio, 0) / faceRatios.length).toFixed(3)} / 최소 ${Math.min(...faceRatios).toFixed(3)} / 최대 ${Math.max(...faceRatios).toFixed(3)}`);
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
