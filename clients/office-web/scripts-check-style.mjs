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
import { makeCharacter } from "./three/character.js";

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

// 캐릭터 — 시트 다섯 종 모두. 옷·머리 색은 사람마다 달라 팔레트 밖에서 들어오지만, 그때도
// 반드시 `toneMat`(톤 보정 문)을 거쳐야 한다. 직접 만든 재질은 톤 보정을 건너뛴 것이다.
for (const sheet of ["char", "charb", "charc", "chard", "chare"]) {
  const figure = makeCharacter({ sheet, shirt: [0.9, 0.5, 0.4], pants: [0.2, 0.2, 0.3], hair: [0.3, 0.2, 0.1] });
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
