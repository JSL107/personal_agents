// 정적 물체 합치기 검증 — 브라우저 없이 node 로 돈다(`pnpm check:merge`).
//
// 합친 뒤 그림이 같아야 한다. 눈으로는 "가구 하나가 빠졌다" 를 놓치기 쉬우므로 삼각형 수와
// 경계 상자로 단정한다 — 물체가 빠지면 삼각형이, 자리가 어긋나면 경계 상자가 달라진다.
import assert from "node:assert/strict";
import * as THREE from "three";
import { BUILDERS, buildFurniture } from "./three/furniture3d/index.js";
import { addOutlines, mat } from "./three/style.js";
import { mergeStatic } from "./three/static-merge.js";

function stats(root) {
  let meshes = 0;
  let triangles = 0;
  root.updateMatrixWorld(true);
  // 실제로 그려지는 것만 센다 — 숨긴 가지 아래는 렌더러도 내려가지 않는다.
  root.traverseVisible((node) => {
    if (node.isMesh && node.material.visible) {
      meshes += 1;
      triangles += (node.geometry.index ?? node.geometry.getAttribute("position")).count / 3;
    }
  });
  return { meshes, triangles, box: new THREE.Box3().setFromObject(root) };
}

const scene = new THREE.Scene();
Object.entries(BUILDERS).forEach(([kind, builder], index) => {
  const piece = buildFurniture(kind, builder.spec.footprint);
  // 자리·방향을 제각각으로 — 월드 좌표로 굽는 계산이 틀리면 경계 상자가 어긋난다.
  piece.position.set((index % 6) * 3, 0, -Math.floor(index / 6) * 3);
  piece.rotation.y = (index % 4) * (Math.PI / 2);
  scene.add(piece);
});
// 크기를 늘린 상자(벽이 이렇게 선다)와 거울상.
const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat("wallCream"));
wall.scale.set(7, 1.7, 0.22);
wall.position.set(3, 0.85, 4);
const mirrored = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat("wallLow"));
mirrored.scale.x = -1;
mirrored.position.set(-3, 0.5, 4);
// 숨긴 가지(대표가 든 서류)와 자식을 단 물체(클릭 판정 상자)는 남아야 한다.
const hidden = new THREE.Group();
hidden.visible = false;
hidden.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat("wallCream")));
const holder = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat("woodLight"));
holder.position.set(-6, 0.2, 4);
const hitBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
hitBox.userData.noOutline = true;
holder.add(hitBox);
scene.add(wall, mirrored, hidden, holder);
addOutlines(scene);

const before = stats(scene);
const startedAt = performance.now();
const batches = mergeStatic(scene);
const elapsed = performance.now() - startedAt;
const after = stats(scene);

assert.equal(after.triangles, before.triangles, "합친 뒤 삼각형 수가 달라졌다 — 빠진 물체가 있다");
assert.equal(after.meshes, batches, "합친 덩어리 말고 그려지는 메시가 남았다");
assert.ok(batches < before.meshes / 10, `덩어리 ${batches}개 — 거의 안 합쳐졌다(전 ${before.meshes}개)`);
for (const axis of ["x", "y", "z"]) {
  assert.ok(Math.abs(after.box.min[axis] - before.box.min[axis]) < 1e-4, `경계 상자 ${axis} 최소가 어긋났다`);
  assert.ok(Math.abs(after.box.max[axis] - before.box.max[axis]) < 1e-4, `경계 상자 ${axis} 최대가 어긋났다`);
}
assert.equal(hidden.children[0]?.material, mat("wallCream"), "숨긴 가지를 건드렸다");
assert.ok(hitBox.parent === holder && holder.parent === scene, "자식을 단 물체가 떨어져 나갔다");
assert.equal(holder.material.visible, false, "자식을 단 물체가 합친 덩어리와 겹쳐 두 번 그려진다");

// 거울상은 면이 뒤집히면 안 된다 — 바깥을 향한 면의 법선과 감는 방향이 같은 쪽이어야 한다.
const low = scene.children.find((node) => node.isMesh && node.material === mat("wallLow") && !node.userData.isOutline);
{
  const position = low.geometry.getAttribute("position");
  const normal = low.geometry.getAttribute("normal");
  const index = low.geometry.index;
  const [a, b, c] = [0, 1, 2].map((i) => new THREE.Vector3().fromBufferAttribute(position, index.getX(i)));
  const face = b.sub(a).cross(c.sub(a));
  const stored = new THREE.Vector3().fromBufferAttribute(normal, index.getX(0));
  assert.ok(face.dot(stored) > 0, "거울상으로 놓인 물체의 면이 뒤집혔다");
}

console.log(
  `✅ 정적 물체 합치기 검증 통과 — 메시 ${before.meshes} → ${after.meshes}개, 삼각형 ${before.triangles}개 그대로 (${elapsed.toFixed(0)}ms)`
);
