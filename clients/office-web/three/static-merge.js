// 움직이지 않는 물체(벽·가구·창)를 **재질마다 한 덩어리**로 합친다.
//
// 가구 하나는 둥근 상자 수십 개이고 상자마다 외곽선 껍질이 하나씩 더 붙는다. 그대로 두면 한 프레임에
// 그리기 호출이 약 9,900번(그림자 지도 포함)이라, 걷는 사람 한 명 때문에 다시 그릴 때마다 그만큼을
// 되풀이한다. 호출 수는 물체 수가 아니라 재질 수만큼이면 된다 — 팔레트가 재질을 공유하게 해 둔
// 이유(`style.js` 의 `mat`)가 이것이다.
//
// 사람은 합치지 않는다(걷고 앉는다). 렌더러가 사람을 장면에 넣기 **전에** 부른다.
import * as THREE from "three";

/** 자식(클릭 판정 상자·글자)을 달고 있어 떼어 낼 수 없는 물체를 안 그리게 만드는 재질. */
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

function mergeable(node) {
  return (
    node.isMesh &&
    !node.isInstancedMesh &&
    !Array.isArray(node.material) &&
    node.material.visible &&
    !node.material.transparent &&
    Boolean(node.geometry.getAttribute("position")) &&
    Boolean(node.geometry.getAttribute("normal"))
  );
}

/** 같은 재질·같은 그림자 설정인 물체들을 월드 좌표로 구워 메시 하나로 만든다. */
function bake(nodes) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const node of nodes) {
    const geometry = node.geometry;
    vertexCount += geometry.getAttribute("position").count;
    indexCount += geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const point = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let vertexAt = 0;
  let indexAt = 0;
  for (const node of nodes) {
    const position = node.geometry.getAttribute("position");
    const normal = node.geometry.getAttribute("normal");
    const index = node.geometry.index;
    normalMatrix.getNormalMatrix(node.matrixWorld);
    for (let i = 0; i < position.count; i += 1) {
      const at = (vertexAt + i) * 3;
      point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).toArray(positions, at);
      point.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().toArray(normals, at);
    }
    // 거울상(음수 배율)으로 놓인 물체는 삼각형이 뒤집힌다 — 감는 방향을 되돌린다.
    const mirrored = node.matrixWorld.determinant() < 0;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const a = vertexAt + (index ? index.getX(i) : i);
      const b = vertexAt + (index ? index.getX(i + 1) : i + 1);
      const c = vertexAt + (index ? index.getX(i + 2) : i + 2);
      indices[indexAt + i] = a;
      indices[indexAt + i + 1] = mirrored ? c : b;
      indices[indexAt + i + 2] = mirrored ? b : c;
    }
    vertexAt += position.count;
    indexAt += count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const first = nodes[0];
  const mesh = new THREE.Mesh(geometry, first.material);
  mesh.castShadow = first.castShadow;
  mesh.receiveShadow = first.receiveShadow;
  // 외곽선은 합치기 전에 이미 붙었고(껍질도 같이 합쳐진다), 다시 붙이면 두 겹이 된다.
  mesh.userData = { noOutline: true, merged: nodes.length };
  return mesh;
}

/**
 * `root` 아래 보이는 메시를 합쳐 넣고 원래 것은 떼어 낸다. 합친 덩어리 수를 돌려준다.
 * 숨긴 가지(`visible = false`)는 건드리지 않는다 — 합치면 숨겨 둔 것이 드러난다.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const batches = new Map();
  const taken = [];
  const visit = (node) => {
    if (!node.visible) {
      return;
    }
    if (mergeable(node)) {
      const key = `${node.material.uuid}|${node.castShadow}|${node.receiveShadow}`;
      if (!batches.has(key)) {
        batches.set(key, []);
      }
      batches.get(key).push(node);
      taken.push(node);
    }
    node.children.forEach(visit);
  };
  visit(root);
  // 떼어 내기 전에 굽는다 — 아래에서 재질을 갈아 끼우는 물체가 있다.
  const baked = [...batches.values()].map(bake);
  // 자식부터 떼어야 부모가 비었는지 알 수 있다(껍질은 제 물체의 자식이다).
  for (const node of taken.reverse()) {
    if (node.children.length > 0) {
      node.material = HIDDEN;
      continue;
    }
    let parent = node.parent;
    node.removeFromParent();
    // 빈 묶음도 걷어 낸다 — 남겨 두면 매 프레임 행렬 갱신이 수천 개를 헛돈다.
    while (parent && parent !== root && parent.children.length === 0 && parent.type === "Group") {
      const next = parent.parent;
      parent.removeFromParent();
      parent = next;
    }
  }
  root.add(...baked);
  return baked.length;
}
