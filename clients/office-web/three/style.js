// 3D 오피스의 그림체 규칙 — 색·재질·모서리·조명을 여기 한 곳에서만 정한다.
//
// 2D 시절 화면이 어긋나 보인 근본 원인은 에셋마다 그림체가 달랐던 것이다(생성 AI 시트를
// 격자에 끼워 맞춤). 3D 에서는 같은 일을 막으려고 **가구 빌더가 재질을 직접 만들 수 없게**
// 했다. 빌더는 `PALETTE` 의 이름만 고르고, 형태는 아래 도우미(둥근 상자·원기둥·구)로만
// 조립한다. 그러면 누가 어떤 가구를 만들어도 같은 색·같은 광택·같은 모서리가 나온다.
// `scripts-check-style.mjs` 가 이 약속을 코드로 확인한다.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * 이름 붙은 색. 레퍼런스(따뜻한 크림 벽·밝은 원목·주황빛 가구)에 맞춘 톤이다.
 * 새 색이 필요하면 여기에 이름을 더한다 — 빌더 안에 16진수를 쓰면 게이트가 막는다.
 */
export const PALETTE = Object.freeze({
  // 벽·바닥
  wallCream: 0xf3e6d3,
  wallLow: 0xe8d5bb,
  wallTrim: 0xd9bf9c,
  floorBase: 0xffffff, // 바닥은 칸마다 색을 따로 준다(인스턴스 색). 바탕은 흰색이어야 곱해져도 그대로다.
  // 원목
  woodLight: 0xdcae74,
  woodMid: 0xc48a52,
  woodDark: 0x8e5b36,
  // 패브릭
  fabricCream: 0xf1e3ca,
  fabricTerracotta: 0xd98c60,
  fabricSage: 0x9fb58b,
  fabricBlue: 0x93abc6,
  // 금속·전자
  metalLight: 0xc9c6c0,
  metalDark: 0x6f6c6a,
  screenDark: 0x3c4352,
  screenGlow: 0xbfe3f2,
  // 식물
  leafLight: 0x8fb873,
  leafDark: 0x62904f,
  potTerracotta: 0xca7a4f,
  potCream: 0xede0cb,
  // 소품
  paper: 0xfbf7ee,
  bookRed: 0xc8634f,
  bookBlue: 0x6f8fb4,
  bookGreen: 0x7fa36a,
  bookMustard: 0xd8aa4f,
  glass: 0xd4e8ee,
  lampWarm: 0xffe2a8,
  // 사람
  skin: 0xf5d2b6,
  /** 직원 피부 — cozy 원화의 밝은 살구색. 가구 쪽 `skin` 보다 밝아야 같은 조명에서 원화 톤이 된다. */
  skinCozy: 0xfde3d1,
  eye: 0x3a2e2a,
  shoe: 0x4b3a30,
  belt: 0x3d352f,
  lens: 0xe9f1f2,
  // 아직 빌더가 없는 가구의 자리 표시
  placeholder: 0xd9c4a6,
  // 원본 가구의 주조색.
  cabinetCharcoal: 0x484653,
  partitionBlue: 0x64788a,
  sofaPurple: 0x913eaa,
  vendingNavy: 0x414c70,
  waterBlue: 0x6bb8ed,
  chairBlack: 0x30343e,
  foliageGreen: 0x4e852e,
});

/** 모든 둥근 상자가 쓰는 모서리 반경(타일 1칸 = 1). 한 값이라 가구끼리 뭉툭함이 같다. */
export const BEVEL = 0.05;

/** 재질은 하나뿐이다 — 무광에 가까운 표준 재질. 광택이 섞이면 장난감 톤이 깨진다. */
const ROUGHNESS = 0.85;

/**
 * 크기 기준(타일 1칸 = 1). 2등신 캐릭터에 맞춘 축척이라 실물 비율보다 가구가 낮다.
 * 빌더가 이 값을 읽어 높이를 맞추면 가구끼리 키가 어긋나지 않는다.
 */
export const SCALE = Object.freeze({
  deskTop: 0.46,
  chairSeat: 0.26,
  /** 소파 방석 윗면(`sofa2`·`sofa3` 의 방석 y 0.22 + 두께 0.08~0.11). */
  sofaSeat: 0.3,
  characterHeight: 0.92,
  wallTall: 1.7,
  wallLow: 0.22,
  floorThickness: 0.06,
});

/**
 * 벽걸이 빌더의 좌표 약속. 렌더러가 원점을 벽면에서 바닥 쪽으로 `-backZ` 만큼 물린 곳에 두고
 * -z 가 벽을 향하게 돌린다. 그래서 빌더는 등판을 z = backZ 에 붙이고 +z(방 안)로 `maxDepth`
 * 까지만 튀어나오게 만든다. 높이는 방 사이 벽(허리 높이)에 걸어도 벽 위로 삐져나오지 않는 한도.
 */
export const WALL_MOUNT = Object.freeze({ backZ: -0.45, maxDepth: 0.14, maxHeight: 0.46, maxWidth: 0.9 });

const materials = new Map();

/** 팔레트 이름 → 재질. 같은 이름은 같은 재질 객체를 돌려준다(그릴 때 묶이기 쉽다). */
export function mat(key) {
  if (!(key in PALETTE)) {
    throw new Error(`팔레트에 없는 색 이름: ${key}`);
  }
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: PALETTE[key],
      roughness: ROUGHNESS,
      metalness: 0,
    });
    material.userData.paletteKey = key;
    materials.set(key, material);
  }
  return material;
}

const toneTarget = new THREE.Color(PALETTE.wallCream);

/**
 * 밖에서 들어온 색(부서 색·셔츠·바지)을 팔레트 톤으로 끌어온다.
 *
 * 부서 색과 셔츠 색은 2D 시절 값이라 채도가 높다. 그대로 칠하면 크림 톤 방 안에서 사람만
 * 형광처럼 뜬다. 크림 쪽으로 `amount` 만큼 섞어 같은 조명 아래 같은 무게로 읽히게 한다.
 */
export function tone(rgb, amount = 0.28) {
  const color = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return color.lerp(toneTarget, amount);
}

const toneMaterials = new Map();

/** `tone` 을 거친 색의 재질. 팔레트 밖 색이 들어오는 유일한 문이다(사람 외형·부서 색). */
export function toneMat(rgb, amount = 0.28) {
  const key = `${rgb.map((value) => value.toFixed(3)).join(",")}@${amount}`;
  let material = toneMaterials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: tone(rgb, amount),
      roughness: ROUGHNESS,
      metalness: 0,
    });
    material.userData.paletteKey = `tone:${key}`;
    toneMaterials.set(key, material);
  }
  return material;
}

/**
 * 가구 빌더에 넘기는 도우미. 좌표는 **바닥 중심 원점**, 각 도형의 `y` 는 그 도형의 **밑면** 높이다.
 * 빌더는 이것만 써서 조립한다 — three.js 를 직접 import 하지 않는다.
 */
export function makeHelper() {
  const group = new THREE.Group();
  const place = (mesh, { x = 0, y = 0, z = 0, rotY = 0 } = {}, height = 0) => {
    mesh.position.set(x, y + height / 2, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  return {
    group,
    /** 둥근 상자. 너비(x)·높이(y)·깊이(z). */
    box(width, height, depth, key, at) {
      const radius = Math.min(BEVEL, width / 2, height / 2, depth / 2) * 0.999;
      const geometry = new RoundedBoxGeometry(width, height, depth, 2, radius);
      return place(new THREE.Mesh(geometry, mat(key)), at, height);
    },
    /** 원기둥. 위·아래 반지름이 다르면 화분·전등갓 같은 뿔대가 된다. */
    cylinder(radiusTop, radiusBottom, height, key, at) {
      const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 20);
      return place(new THREE.Mesh(geometry, mat(key)), at, height);
    },
    /** 구. `squash` 로 세로를 눌러 잎 뭉치·쿠션을 만든다. */
    sphere(radius, key, at = {}, squash = 1) {
      const geometry = new THREE.SphereGeometry(radius, 20, 14);
      const mesh = place(new THREE.Mesh(geometry, mat(key)), at, 0);
      mesh.scale.y = squash;
      mesh.position.y = (at.y ?? 0) + radius * squash;
      return mesh;
    },
  };
}

/**
 * 조명 한 세트 — 하늘빛(위에서 오는 부드러운 전체광) + 해 하나(그림자).
 * 해는 카메라 왼쪽 위에서 비춰 그림자가 오른쪽 뒤로 짧게 떨어진다(레퍼런스와 같은 방향).
 */
export function makeLights(center, extent) {
  const hemisphere = new THREE.HemisphereLight(0xfff6ea, 0xe7d3b8, 1.9);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(center.x - extent * 0.35, extent * 0.9, center.z + extent * 0.55);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = extent * 4;
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0008;
  // 정면 보조광 — 해가 위에서만 비추면 사람의 앞면(셔츠·얼굴)이 탁해진다(흰 셔츠가 베이지로
  // 보였다). 그림자는 만들지 않고 카메라 쪽에서 약하게 채운다.
  const fill = new THREE.DirectionalLight(0xfff8f0, 0.55);
  fill.position.set(center.x + extent * 0.3, extent * 0.3, center.z + extent);
  fill.target.position.copy(center);
  return [hemisphere, sun, sun.target, fill, fill.target];
}

/**
 * 바닥재별 바탕색. 칸마다 인스턴스 색으로 칠하므로 팔레트(재질)가 아니라 여기 둔다.
 * 2D 시절처럼 부서 색을 조금 섞어 방을 구별하지만, 밝기는 한 구간에 모아 방마다 튀지 않게 한다.
 */
export const FLOOR_COLORS = Object.freeze({
  woodA: 0xe6c59b,
  woodB: 0xdfbb8e,
  carpetLight: 0xeadcc6,
  carpetDark: 0xdcc8aa,
  ceramic: 0xefe7da,
  corridor: 0xe9ddca,
});

/** 부서 색을 바닥에 섞는 비율. 크면 방이 원색으로 칠해져 레퍼런스 톤을 벗어난다. */
export const FLOOR_TINT = 0.14;

// MARK: - 외곽선

/**
 * 외곽선 — 원본 2D 직원 그림의 또렷함(검은 테두리)을 3D 에 옮긴다.
 *
 * 물체마다 법선 방향으로 조금 부풀린 뒷면 껍질을 어두운 색으로 한 번 더 그린다(inverted hull).
 * 부풀리는 양은 **화면 픽셀 기준**이라 전체 조감에서도 방 확대에서도 같은 굵기로 보인다 —
 * 월드 단위로 두면 조감에서는 사라지고 확대에서는 두꺼워진다. 렌더러가 카메라 범위를 바꿀
 * 때마다 `setOutlineWidth` 로 맞춘다.
 *
 * 법선 변환을 뷰 공간에서 하므로 벽처럼 크기를 늘린(scale) 상자에도 굵기가 고르다.
 */
export const OUTLINE = Object.freeze({ color: 0x33271f, pixels: 1.4 });

const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: {
    thickness: { value: 0.01 },
    color: { value: new THREE.Color(OUTLINE.color) },
  },
  vertexShader: /* glsl */ `
    uniform float thickness;
    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      vec3 viewNormal = normalize(normalMatrix * normal);
      viewPosition.xyz += viewNormal * thickness;
      gl_Position = projectionMatrix * viewPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    void main() {
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }
  `,
  side: THREE.BackSide,
});
outlineMaterial.userData.paletteKey = "outline";

/** 외곽선 굵기를 월드 단위로 맞춘다(픽셀 × 픽셀당 월드 길이). */
export function setOutlineWidth(worldUnits) {
  outlineMaterial.uniforms.thickness.value = worldUnits;
}

/**
 * `root` 아래 메시마다 외곽선 껍질을 붙인다. `userData.noOutline` 인 것(눈 하이라이트·유리·
 * 상태 링)과 인스턴스 메시(바닥)는 건너뛴다. 두 번 불러도 한 번만 붙는다.
 */
export function addOutlines(root) {
  const targets = [];
  root.traverse((node) => {
    if (
      node.isMesh &&
      !node.isInstancedMesh &&
      !node.userData.noOutline &&
      !node.userData.isOutline &&
      !node.userData.hasOutline
    ) {
      targets.push(node);
    }
  });
  for (const node of targets) {
    const hull = new THREE.Mesh(node.geometry, outlineMaterial);
    hull.userData.isOutline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    node.add(hull);
    node.userData.hasOutline = true;
  }
  return root;
}

/** 배경 — 레퍼런스처럼 방 바깥은 옅은 크림이다. */
export const BACKGROUND = 0xf7efe4;
