// 캐릭터 — 기존 2D 직원 그림(`char`·`charb`·`charc`·`chard`·`chare` 시트)을 3D 로 옮긴 것.
//
// 처음에는 머리가 절반 넘는 마스코트형으로 만들었는데, 기존 직원들과 다른 사람이 됐다(머리
// 모양·안경·칼라 셔츠가 사라져 31명이 한 사람처럼 보였다). 그래서 비율과 옷차림을 원본
// 스프라이트에서 재어 맞췄다(정면 54px 기준): 머리 39% · 몸통 34% · 다리와 구두 27%,
// 머리 폭 = 팔까지 포함한 어깨 폭. 사람마다 다른 것은 평면도의 `agentLooks` 가 준다 —
// `sheet` 가 머리 모양, `hair`·`shirt`·`pants` 가 색.
//
// 방향별 그림이 따로 필요 없다 — 몸 하나를 돌리고 팔다리만 움직인다.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { addOutlines, mat, toneMat, SCALE } from "./style.js";

/** 방향 → y축 회전. 정면(down)이 카메라 쪽(+z)이다. */
const FACING_ROTATION = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };

/** 걸음 한 번에 다리가 흔들리는 각도(라디안)와 빠르기. */
const STRIDE = 0.5;
const STRIDE_SPEED = 11;

/** 높이 기준(원본 스프라이트 54px 를 키 0.92 로 옮긴 값). */
const BODY = {
  shoe: 0.06,
  hip: 0.27,
  shoulder: 0.56,
  headCenter: 0.745,
  headRadius: 0.19,
  torsoWidth: 0.3,
  torsoDepth: 0.2,
};

/**
 * 모서리를 아주 조금 둥글린 상자. 각진 BoxGeometry 는 면마다 법선이 갈라져 외곽선 껍질이
 * 모서리에서 벌어진다(몸통·다리에 테두리가 안 보였다). 둥글리면 법선이 이어져 테가 닫힌다.
 */
function roundedBox(width, height, depth) {
  return new RoundedBoxGeometry(width, height, depth, 2, Math.min(0.015, width / 2, height / 2, depth / 2) * 0.99);
}

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const node = new THREE.Mesh(geometry, material);
  node.position.set(x, y, z);
  node.castShadow = true;
  return node;
}

/** 원래 색보다 조금 어두운 같은 색 — 셔츠 단추선·칼라 그림자. */
function darker(rgb, factor = 0.82) {
  return rgb.map((value) => value * factor);
}

// MARK: - 머리 모양 (시트별)

/** 기본 머리 — 정수리·뒤통수를 덮는 모자형 + 앞머리. 모든 시트의 바탕이다. */
function baseHair(head, hair) {
  const r = BODY.headRadius;
  const cap = mesh(new THREE.SphereGeometry(r * 1.07, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), hair);
  cap.rotation.x = -0.28;
  cap.position.set(0, 0.012, -0.012);
  // 앞머리 — 이마를 가로로 덮는 둥근 판. 원본은 눈썹 바로 위까지 내려온다.
  // SphereGeometry 의 phi 는 -x 에서 시작해 +z(얼굴 쪽)가 π/2 다 — 그 둘레로 잡는다.
  const fringe = mesh(
    new THREE.SphereGeometry(r * 1.04, 24, 10, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.2, Math.PI * 0.2),
    hair
  );
  fringe.material = hair;
  // 옆머리 — 귀 높이까지 내려와 얼굴 윤곽을 감싼다(원본 정면의 양옆 검은 선).
  for (const side of [-1, 1]) {
    const sideburn = mesh(new THREE.SphereGeometry(r * 0.35, 12, 10), hair, side * r * 0.86, -0.02, -0.01);
    sideburn.scale.set(0.45, 1.1, 0.9);
    head.add(sideburn);
  }
  // 앞머리 끝 가닥 — 일자 끝선이면 헬멧처럼 읽힌다(원본은 가닥이 이마로 삐쳐 내려온다).
  [-0.11, -0.04, 0.04, 0.11].forEach((x, index) => {
    const tuft = mesh(new THREE.ConeGeometry(0.035, 0.07, 8), hair, x, 0.035 - (index % 2) * 0.012, r * 0.9);
    tuft.rotation.x = Math.PI + 0.35;
    tuft.rotation.z = x * 1.5;
    // 가닥에 테를 두르면 뿔처럼 무거워진다 — 앞머리 윤곽은 모자형의 외곽선이 이미 그린다.
    tuft.userData.noOutline = true;
    head.add(tuft);
  });
  head.add(cap, fringe);
}

const HAIR_STYLES = {
  /** 짧은 머리. */
  char(head, hair) {
    baseHair(head, hair);
  },
  /** 묶은 머리 — 뒤통수에 매듭, 그 아래로 늘어진 꼬리. */
  charb(head, hair) {
    baseHair(head, hair);
    head.add(mesh(new THREE.SphereGeometry(0.06, 14, 10), hair, 0, 0.03, -0.2));
    const tail = mesh(new THREE.CapsuleGeometry(0.045, 0.14, 4, 10), hair, 0, -0.08, -0.22);
    tail.rotation.x = 0.25;
    head.add(tail);
  },
  /** 짧은 머리 + 안경 — 테 두 개와 다리(브리지). */
  charc(head, hair) {
    baseHair(head, hair);
    const frame = mat("eye");
    const lens = mat("lens");
    for (const x of [-0.07, 0.07]) {
      const ring = mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 20), frame, x, -0.015, BODY.headRadius - 0.01);
      const glass = mesh(new THREE.CircleGeometry(0.042, 20), lens, x, -0.015, BODY.headRadius - 0.012);
      glass.userData.noOutline = true;
      ring.userData.noOutline = true;
      head.add(glass, ring);
    }
    head.add(mesh(new THREE.BoxGeometry(0.05, 0.01, 0.01), frame, 0, -0.01, BODY.headRadius - 0.005));
  },
  /** 곱슬 — 모자형 위에 작은 뭉치를 올려 윤곽을 울퉁불퉁하게. */
  chard(head, hair) {
    baseHair(head, hair);
    const r = BODY.headRadius;
    const bumps = 11;
    for (let index = 0; index < bumps; index += 1) {
      const angle = (index / bumps) * Math.PI * 2;
      const ring = index % 2 === 0 ? 0.55 : 0.8;
      const x = Math.sin(angle) * r * ring;
      const z = Math.cos(angle) * r * ring - 0.03;
      // 뭉치가 두피 위로 너무 솟으면 키가 커진다 — 원본 곱슬 시트는 다른 시트보다 1px(2%)만 크다.
      const y = Math.sqrt(Math.max(0, r * r - x * x - z * z)) * 0.8;
      head.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), hair, x, y, z));
    }
  },
  /** 긴 단발 — 옆머리와 뒷머리가 어깨 가까이까지 내려온다. */
  chare(head, hair) {
    baseHair(head, hair);
    const r = BODY.headRadius;
    const back = mesh(new THREE.CapsuleGeometry(r * 0.9, 0.1, 6, 16), hair, 0, -0.06, -0.07);
    back.scale.set(1.02, 1, 0.75);
    head.add(back);
    for (const x of [-1, 1]) {
      const side = mesh(new THREE.CapsuleGeometry(0.035, 0.16, 4, 8), hair, x * r * 0.9, -0.1, 0.03);
      head.add(side);
    }
  },
};

// MARK: - 몸

export function makeCharacter(look) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const shirtRgb = look.shirt ?? [0.95, 0.95, 0.94];
  const shirt = toneMat(shirtRgb, 0.12);
  const shirtShade = toneMat(darker(shirtRgb), 0.12);
  const pants = toneMat(look.pants, 0.12);
  const hair = toneMat(look.hair, 0.05);
  const skin = mat("skin");

  // 다리 — 엉덩이 피벗(허벅지 방향) 아래 무릎 피벗(정강이 방향). 앉으면 허벅지는 앞으로,
  // 정강이는 아래로 꺾인다. 원본의 두 다리는 거의 붙어 있어 간격을 좁게 둔다.
  const thigh = (BODY.hip - BODY.shoe) / 2;
  const legs = [-0.065, 0.065].map((x) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(x, BODY.hip, 0);
    hipPivot.add(mesh(roundedBox(0.1, thigh, 0.11), pants, 0, -thigh / 2, 0));
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    knee.add(mesh(roundedBox(0.095, thigh, 0.105), pants, 0, -thigh / 2, 0));
    knee.add(mesh(roundedBox(0.1, BODY.shoe, 0.15), mat("shoe"), 0, -thigh - BODY.shoe / 2, 0.02));
    hipPivot.add(knee);
    body.add(hipPivot);
    return { hip: hipPivot, knee };
  });

  // 몸통 — 셔츠. 벨트, 가운데 단추선, 칼라 두 조각.
  const torsoHeight = BODY.shoulder - BODY.hip;
  const torso = mesh(roundedBox(BODY.torsoWidth, torsoHeight, BODY.torsoDepth), shirt, 0, BODY.hip + torsoHeight / 2, 0);
  body.add(torso);
  body.add(mesh(roundedBox(BODY.torsoWidth + 0.005, 0.03, BODY.torsoDepth + 0.005), mat("belt"), 0, BODY.hip + 0.015, 0));
  // 단추선·칼라 테는 그 자체가 선이라 외곽선을 따로 두르지 않는다.
  const placket = mesh(new THREE.BoxGeometry(0.012, torsoHeight - 0.05, 0.005), shirtShade, 0, BODY.hip + torsoHeight / 2 + 0.01, BODY.torsoDepth / 2 + 0.002);
  placket.userData.noOutline = true;
  body.add(placket);
  for (const side of [-1, 1]) {
    // 칼라 — 목 양옆에서 비스듬히 내려오는 두 조각. 아랫변만 그늘색으로 테를 둘러 판이 읽히게.
    const collar = mesh(new THREE.BoxGeometry(0.085, 0.045, 0.02), shirt, side * 0.045, BODY.shoulder - 0.022, BODY.torsoDepth / 2 + 0.008);
    collar.rotation.z = side * 0.55;
    body.add(collar);
    const edge = mesh(new THREE.BoxGeometry(0.085, 0.008, 0.021), shirtShade, side * 0.052, BODY.shoulder - 0.036, BODY.torsoDepth / 2 + 0.009);
    edge.rotation.z = side * 0.55;
    edge.userData.noOutline = true;
    body.add(edge);
  }

  // 팔 — 어깨 피벗에서 내려오는 소매 + 손. 원본처럼 몸 옆에 붙인다.
  const armLength = torsoHeight - 0.04;
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (BODY.torsoWidth / 2 + 0.02), BODY.shoulder - 0.03, 0);
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.028, armLength - 0.05, 4, 10), shirt, 0, -armLength / 2, 0));
    shoulder.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), skin, 0, -armLength - 0.02, 0));
    body.add(shoulder);
    return shoulder;
  });

  // 목·머리·얼굴. 얼굴은 눈과 눈썹만 — 원본의 담백한 얼굴을 따른다.
  body.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 12), skin, 0, BODY.shoulder + 0.01, 0));
  const head = new THREE.Group();
  head.position.y = BODY.headCenter;
  const face = mesh(new THREE.SphereGeometry(BODY.headRadius, 24, 18), skin);
  face.scale.set(1, 0.95, 0.94);
  head.add(face);
  for (const x of [-0.07, 0.07]) {
    const eye = mesh(new THREE.SphereGeometry(0.022, 10, 8), mat("eye"), x, -0.015, BODY.headRadius * 0.9);
    eye.scale.set(0.8, 1.25, 0.5);
    eye.userData.noOutline = true;
    // 눈동자 하이라이트 — 원본 눈의 흰 점. 이것 하나로 얼굴이 멍한 점 눈에서 벗어난다.
    const glint = mesh(new THREE.SphereGeometry(0.007, 8, 6), mat("paper"), x + 0.007, -0.004, BODY.headRadius * 0.9 + 0.012);
    glint.userData.noOutline = true;
    head.add(eye, glint);
    const brow = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), hair, x, 0.035, BODY.headRadius * 0.9);
    brow.userData.noOutline = true;
    head.add(brow);
  }
  (HAIR_STYLES[look.sheet] ?? HAIR_STYLES.char)(head, hair);
  body.add(head);

  root.add(body);
  root.userData = { body, legs, arms };
  return addOutlines(root);
}

/** 상태 링 — 발밑 원판. 색은 백엔드 상태(`stateColors`). */
export function makeStatusRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.28, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  ring.renderOrder = 1;
  ring.userData.noOutline = true;
  return ring;
}

/**
 * 한 프레임 자세를 입힌다. `body` 는 live.js 가 정한 {x, y, pose, facing, seated}.
 * 걷는 중인지는 pose 이름(`down-walk1` 등)으로 안다 — live.js 가 2D 그림 이름을 그대로 쓴다.
 */
export function poseCharacter(character, body, now) {
  const { body: figure, legs, arms } = character.userData;
  character.rotation.y = FACING_ROTATION[body.seated ? "down" : body.facing] ?? 0;
  if (body.seated) {
    // 엉덩이를 의자 좌판 높이로 내리고, 허벅지는 앞으로·정강이는 아래로. 손은 책상 쪽으로.
    figure.position.y = SCALE.chairSeat + 0.03 - BODY.hip;
    for (const leg of legs) {
      leg.hip.rotation.x = -Math.PI / 2;
      leg.knee.rotation.x = Math.PI / 2;
    }
    for (const arm of arms) {
      arm.rotation.x = -0.7;
    }
    return;
  }
  const walking = typeof body.pose === "string" && body.pose.includes("walk");
  const phase = now * STRIDE_SPEED;
  figure.position.y = walking ? Math.abs(Math.sin(phase)) * 0.02 : 0;
  legs.forEach((leg, index) => {
    leg.hip.rotation.x = walking ? Math.sin(phase + index * Math.PI) * STRIDE : 0;
    leg.knee.rotation.x = walking ? Math.max(0, Math.sin(phase + index * Math.PI + 0.6)) * 0.4 : 0;
  });
  arms.forEach((arm, index) => {
    arm.rotation.x = walking ? Math.sin(phase + (index + 1) * Math.PI) * STRIDE * 0.6 : 0;
  });
}
