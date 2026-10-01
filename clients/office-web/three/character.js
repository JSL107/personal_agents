// 캐릭터 — 맥 2D 가 쓰는 cozy 원화(`cozy/characters/agent-<번호>.png`)의 직원을 3D 로 옮긴 것.
//
// 처음에는 옛 도트 스프라이트(`sprites/char-*.png`, 54px)의 비율을 재어 만들었는데, 맥 2D 는 이미
// 일러스트 원화로 바뀌어 있어 3D 만 투박한 딴사람이 됐다(사용자 보고: "캐릭터 디자인이 너무 구리다").
// 이제 기준은 원화다 — 큰 머리·큰 눈·볼터치·사람마다 다른 머리 모양과 니트 옷. 누가 어느 원화인지는
// 평면도의 `agentLooks[*].cozyAsset`, 원화별 생김새는 `cozy-looks.js` 가 정한다.
//
// 방향별 그림이 따로 필요 없다 — 몸 하나를 돌리고 팔다리만 움직인다.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { addOutlines, mat, tone, toneMat, SCALE } from "./style.js";
import { cozyLookFor } from "./cozy-looks.js";

/** 방향 → y축 회전. 정면(down)이 카메라 쪽(+z)이다. */
const FACING_ROTATION = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const OPPOSITE = { down: "up", up: "down", left: "right", right: "left" };
/** 방향 → 평면도 칸 한 걸음(y 는 북쪽이 +). */
const FACING_STEP = { down: [0, -1], up: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * 소파 좌석에서 몸을 소파 쪽으로 옮기는 거리(칸). 좌석은 소파 **앞 칸**이라 그 자리에 앉히면
 * 빈 바닥 위 허공에 앉는다(사용자 보고: "공중에 앉아있음"). 2D 의 `loungeSpriteShift` 와 같은
 * 자리지만 값은 3D 소파의 방석 위치(소파 칸 중심에서 좌석 쪽으로 0.04~0.06)에서 쟀다.
 */
const LOUNGE_SHIFT = 0.8;

/** 가구에 앉은 것인가(소파) — 책상 의자 착석(`sendHome`)과 구별한다. */
function isLounging(body) {
  return body.seated && body.interactionPose === "sitting";
}

/**
 * 몸이 좌석 칸에서 옮겨 간 양(평면도 칸 단위, y 는 북쪽이 +). 렌더러가 몸과 발밑 링에 같이 쓴다 —
 * 한쪽만 옮기면 링이 빈 바닥에 남는다(2D `groundOffset` 과 같은 규칙).
 */
export function seatOffset(body) {
  if (!isLounging(body)) {
    return { x: 0, y: 0 };
  }
  const [x, y] = FACING_STEP[body.facing] ?? [0, 0];
  return { x: x * LOUNGE_SHIFT, y: y * LOUNGE_SHIFT };
}

/** 걸음 한 번에 다리가 흔들리는 각도(라디안)와 빠르기. */
const STRIDE = 0.5;
/** 평소 고개를 드는 각(라디안). */
const HEAD_LIFT = 0.22;
const STRIDE_SPEED = 11;

/**
 * 높이 기준 — 맥 2D 의 cozy 원화(750×900) 비율을 키 0.92 로 옮긴 값. 머리가 키의 절반 가까이다
 * (원화 실측: 머리카락 포함 머리 46% · 몸통 24% · 다리와 구두 30%).
 */
const BODY = {
  shoe: 0.05,
  hip: 0.23,
  shoulder: 0.44,
  headCenter: 0.655,
  headRadius: 0.2,
  torsoWidth: 0.3,
  torsoDepth: 0.21,
};

/**
 * 모서리를 아주 조금 둥글린 상자. 각진 BoxGeometry 는 면마다 법선이 갈라져 외곽선 껍질이
 * 모서리에서 벌어진다(몸통·다리에 테두리가 안 보였다). 둥글리면 법선이 이어져 테가 닫힌다.
 */
function roundedBox(width, height, depth) {
  return new RoundedBoxGeometry(width, height, depth, 2, Math.min(0.015, width / 2, height / 2, depth / 2) * 0.99);
}

/** 모서리를 크게 둥글린 상자 — 니트 몸통. 각지면 원화의 폭신한 옷이 상자로 읽힌다. */
function softBox(width, height, depth) {
  return new RoundedBoxGeometry(width, height, depth, 4, Math.min(width, height, depth) * 0.3);
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

/** 피부색(`PALETTE.skin` 0xf5d2b6). 셔츠가 이 색과 붙으면 맨살로 읽힌다. */
const SKIN_RGB = [0xf5 / 255, 0xd2 / 255, 0xb6 / 255];
/** 셔츠와 피부가 이만큼(RGB 유클리드 거리)은 떨어져야 한다. 0.25 는 한 단계만 눌러 여전히 살색으로 읽혔다. */
export const SHIRT_SKIN_MIN_DISTANCE = 0.35;
/** 셔츠 재질이 크림색 쪽으로 섞이는 몫(`toneMat(shirt, SHIRT_TONE)`). 대비는 섞은 **뒤** 색으로 잰다. */
const SHIRT_TONE = 0.12;

/** 실제로 칠해지는 셔츠 색(sRGB)과 피부의 거리. */
export function shirtSkinDistance(rgb) {
  const painted = {};
  tone(rgb, SHIRT_TONE).getRGB(painted, THREE.SRGBColorSpace);
  return Math.hypot(painted.r - SKIN_RGB[0], painted.g - SKIN_RGB[1], painted.b - SKIN_RGB[2]);
}

/**
 * 셔츠가 피부와 구별되게 — 너무 가까우면 같은 색조로 진하게 누른다.
 *
 * 콘텐츠 부서 셔츠(살구·분홍 계열, 예: 0.97·0.73·0.67)는 피부와 거리 0.1 남짓이라 셔츠를 안 입은
 * 사람처럼 보였다(사용자 보고). 2D 는 스프라이트 외곽선이 칼라·소매를 갈라 줘서 덜 드러났다.
 * 부서 색조는 지키려고 색상을 바꾸지 않고 밝기만 내린다.
 *
 * **피부와 같은 난색(빨강 > 초록 > 파랑)만** 누른다. RGB 거리만 보면 흰·회색·하늘색 셔츠도
 * 0.2~0.33 으로 "가깝다" 에 걸리는데, 색조가 달라 눈으로는 이미 갈린다 — 누르면 흰 셔츠가 회색이 된다.
 */
export function distinctShirt(rgb) {
  const [red, green, blue] = rgb;
  if (!(red > green && green > blue)) {
    return rgb;
  }
  let shirt = rgb;
  for (let step = 0; step < 6; step += 1) {
    // 재질이 크림색 쪽으로 12% 섞이며 피부에 다시 가까워진다 — 섞기 전 색으로 재면 기준을 넘긴
    // 셔츠가 칠해진 뒤에는 기준 안으로 돌아온다(리뷰 지적: 0.368 → 0.301).
    if (shirtSkinDistance(shirt) >= SHIRT_SKIN_MIN_DISTANCE) {
      break;
    }
    shirt = darker(shirt, 0.86);
  }
  return shirt;
}

// MARK: - 얼굴

const R = BODY.headRadius;
/** 얼굴 구의 배율. 볼이 살짝 통통하고 앞뒤로 조금 납작하다. */
const FACE_SCALE = [1.02, 0.95, 0.92];

/** 얼굴 표면의 z(머리 중심 기준). 눈·볼·입을 표면에 붙이는 데 쓴다. */
function faceZ(x, y) {
  const inside = R * R - (x / FACE_SCALE[0]) ** 2 - (y / FACE_SCALE[1]) ** 2;
  return FACE_SCALE[2] * Math.sqrt(Math.max(0, inside));
}

/** 그림자·외곽선을 두르지 않는 작은 조각(눈·볼·입·소품 끝). 그림자 패스 호출을 늘리지 않는다. */
function detail(geometry, material, x = 0, y = 0, z = 0) {
  const node = mesh(geometry, material, x, y, z);
  node.castShadow = false;
  node.userData.noOutline = true;
  return node;
}

/**
 * 원화의 얼굴 — 큰 갈색 눈(흰 반짝임 둘 + 윗속눈썹), 분홍 볼, 작은 입, 귀.
 * 원화는 모두 같은 얼굴 틀에 표정만 조금 다르다(`smile`: 벌린 웃음 · 다문 웃음).
 */
function buildFace(head, look) {
  const skin = mat("skinCozy");
  const face = mesh(new THREE.SphereGeometry(R, 28, 20), skin);
  face.scale.set(...FACE_SCALE);
  head.add(face);
  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.045, 12, 10), skin, side * R * 0.98, -0.035, -0.01);
    ear.scale.set(0.5, 1, 0.8);
    head.add(ear);
  }
  const iris = toneMat([0.33, 0.2, 0.13], 0);
  const lash = mat("eye");
  const glint = mat("paper");
  const blush = toneMat([0.99, 0.74, 0.7], 0);
  for (const side of [-1, 1]) {
    const x = side * 0.08;
    const y = -0.035;
    const z = faceZ(x, y);
    const eye = detail(new THREE.SphereGeometry(0.05, 16, 12), iris, x, y, z - 0.012);
    eye.scale.set(0.78, 1, 0.34);
    eye.rotation.y = side * 0.4;
    head.add(eye);
    head.add(detail(new THREE.SphereGeometry(0.016, 8, 6), glint, x + side * 0.004 + 0.01, y + 0.02, z + 0.006));
    head.add(detail(new THREE.SphereGeometry(0.008, 6, 5), glint, x - 0.012, y - 0.02, z + 0.004));
    // 윗속눈썹 — 눈 위를 감싸는 호. 바깥 끝이 살짝 올라가야 웃는 눈이 된다(곧은 막대는 처져 울상이 됐다).
    const upper = detail(new THREE.TorusGeometry(0.043, 0.008, 6, 14, Math.PI * 0.85), lash, x, y + 0.004, z - 0.004);
    upper.rotation.set(0, side * 0.4, Math.PI * 0.075 + (side < 0 ? 0.08 : -0.08));
    upper.scale.set(0.95, 1.1, 1);
    head.add(upper);
    const cheek = detail(new THREE.CircleGeometry(0.034, 16), blush, side * 0.125, -0.09, faceZ(side * 0.125, -0.09) + 0.003);
    cheek.rotation.y = side * 0.62;
    cheek.scale.y = 0.7;
    head.add(cheek);
  }
  const mouthColor = toneMat([0.62, 0.24, 0.24], 0);
  const mouthZ = faceZ(0, -0.11) + 0.003;
  if (look.smile === "open") {
    // 아래 반원 — 벌린 웃음.
    head.add(detail(new THREE.CircleGeometry(0.026, 16, Math.PI, Math.PI), mouthColor, 0, -0.1, mouthZ));
  } else {
    const smile = detail(new THREE.TorusGeometry(0.016, 0.004, 6, 12, Math.PI), mouthColor, 0, -0.098, mouthZ);
    smile.rotation.z = Math.PI;
    head.add(smile);
  }
}

// MARK: - 머리

/**
 * 머리카락 바탕 — 정수리를 덮는 모자, 얼굴 창만 뚫린 뒷·옆머리, 앞머리 세 덩이, 정수리 볼륨.
 * 원화는 모두 머리숱이 많아 얼굴보다 한참 크다. 둥근 덩이를 겹쳐 그 부피를 낸다.
 */
function baseHair(head, hair, fringe = 3) {
  // SphereGeometry 의 phi 는 -x 에서 시작해 +z(얼굴)가 π/2 다.
  const shell = R * 1.1;
  const cap = mesh(new THREE.SphereGeometry(shell, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), hair);
  const window = 0.62;
  const back = mesh(
    new THREE.SphereGeometry(shell, 28, 14, Math.PI / 2 + window, Math.PI * 2 - window * 2, Math.PI * 0.4, Math.PI * 0.42),
    hair
  );
  for (const part of [cap, back]) {
    part.scale.set(1.06, 1.04, 1.02);
    part.position.set(0, 0.02, -0.012);
    head.add(part);
  }
  const crown = mesh(new THREE.SphereGeometry(0.13, 18, 12), hair, 0, 0.12, -0.04);
  crown.scale.set(1.3, 0.72, 1.15);
  head.add(crown);
  // 앞머리 — 이마 위 둥근 덩이. 가운데를 조금 비워 이마가 보이게 가르마를 탄다.
  const spots = fringe === 3 ? [-0.1, 0.0, 0.1] : [-0.12, -0.04, 0.05, 0.12];
  spots.forEach((x, index) => {
    const y = 0.085 - Math.abs(x) * 0.25;
    const lock = mesh(new THREE.SphereGeometry(0.075, 14, 10), hair, x, y, faceZ(x, y) - 0.012);
    lock.scale.set(1.15, 0.72, 0.55);
    lock.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.35;
    head.add(lock);
  });
}

/** 볼 옆으로 내려오는 옆머리 한 쌍. `drop` 이 길이(아래로 얼마나). */
function sideLocks(head, hair, drop, bulk = 1) {
  for (const side of [-1, 1]) {
    const lock = mesh(new THREE.SphereGeometry(0.09 * bulk, 14, 10), hair, side * R * 0.95, -drop / 2, 0.01);
    lock.scale.set(0.62, 1 + drop * 4, 0.95);
    head.add(lock);
  }
}

/** 곱슬 뭉치 — 머리 겉면에 작은 덩이를 흩뿌린다. */
function curls(head, hair, count, radius) {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const tilt = index % 2 === 0 ? 0.42 : 0.9;
    const x = Math.sin(angle) * Math.sin(tilt) * R * 1.12;
    const z = Math.cos(angle) * Math.sin(tilt) * R * 1.12 - 0.03;
    const y = Math.cos(tilt) * R * 1.12 + 0.03;
    // 얼굴 앞으로는 내리지 않는다 — 이마를 덮으면 눈이 가린다.
    if (z > 0.1 && y < 0.12) {
      continue;
    }
    head.add(mesh(new THREE.SphereGeometry(radius, 10, 8), hair, x, y, z));
  }
}

/** 묶은 머리끈·리본. */
function tie(head, color, x, y, z, bow) {
  const material = toneMat(color, 0.05);
  if (!bow) {
    head.add(detail(new THREE.SphereGeometry(0.03, 10, 8), material, x, y, z));
    return;
  }
  for (const side of [-1, 1]) {
    const loop = detail(new THREE.SphereGeometry(0.035, 10, 8), material, x + side * 0.03, y, z);
    loop.scale.set(1, 0.7, 0.5);
    head.add(loop);
  }
}

const HAIR_STYLES = {
  short(head, hair) {
    baseHair(head, hair);
    sideLocks(head, hair, 0.04, 0.85);
  },
  curly(head, hair) {
    baseHair(head, hair, 4);
    sideLocks(head, hair, 0.05, 0.9);
    curls(head, hair, 14, 0.05);
  },
  bob(head, hair) {
    baseHair(head, hair, 4);
    sideLocks(head, hair, 0.13, 1.15);
    const back = mesh(new THREE.SphereGeometry(0.19, 18, 12), hair, 0, -0.07, -0.08);
    back.scale.set(1.12, 0.95, 0.85);
    head.add(back);
  },
  long(head, hair) {
    baseHair(head, hair, 4);
    sideLocks(head, hair, 0.18, 1.15);
    const back = mesh(new THREE.CapsuleGeometry(0.17, 0.22, 6, 16), hair, 0, -0.16, -0.08);
    back.scale.set(1.2, 1, 0.62);
    head.add(back);
    for (const side of [-1, 1]) {
      const wave = mesh(new THREE.CapsuleGeometry(0.055, 0.18, 4, 10), hair, side * 0.2, -0.24, 0);
      wave.rotation.z = side * 0.12;
      head.add(wave);
    }
  },
  ponytail(head, hair, look) {
    baseHair(head, hair, 4);
    sideLocks(head, hair, 0.07, 1);
    const tail = mesh(new THREE.CapsuleGeometry(0.055, 0.18, 4, 10), hair, R * 1.02, -0.22, -0.02);
    tail.rotation.z = 0.28;
    head.add(tail);
    tie(head, look.extras.bow ?? [0.6, 0.5, 0.45], R * 0.98, -0.1, 0.02, Boolean(look.extras.bow));
  },
  braids(head, hair, look) {
    baseHair(head, hair, 4);
    sideLocks(head, hair, 0.05, 0.9);
    for (const side of [-1, 1]) {
      [-0.12, -0.19, -0.26].forEach((y, index) => {
        head.add(mesh(new THREE.SphereGeometry(0.048 - index * 0.004, 10, 8), hair, side * (R * 1.0 + index * 0.01), y, -0.01));
      });
      tie(head, look.extras.bow ?? [0.9, 0.7, 0.3], side * R * 1.02, -0.31, -0.01, false);
    }
  },
  braid(head, hair, look) {
    baseHair(head, hair, 4);
    sideLocks(head, hair, 0.09, 1);
    [-0.12, -0.19, -0.26, -0.33].forEach((y, index) => {
      head.add(mesh(new THREE.SphereGeometry(0.05 - index * 0.004, 10, 8), hair, R * 1.0 + index * 0.012, y, 0.02));
    });
    tie(head, look.extras.bow ?? [0.7, 0.55, 0.88], R * 1.04, -0.38, 0.02, true);
  },
  spiky(head, hair) {
    baseHair(head, hair, 4);
    sideLocks(head, hair, 0.04, 0.85);
    [-0.12, -0.05, 0.03, 0.1].forEach((x, index) => {
      const spike = mesh(new THREE.ConeGeometry(0.05, 0.12, 8), hair, x, 0.2 - Math.abs(x) * 0.3, -0.02 - index * 0.01);
      spike.rotation.z = -x * 2.5;
      head.add(spike);
    });
  },
};

/** 머리에 붙는 소품 — 안경·핀·머리띠·헤드셋. */
function headExtras(head, extras) {
  if (extras.glasses) {
    const frame = toneMat(extras.glasses, 0);
    const lens = mat("lens");
    for (const side of [-1, 1]) {
      const x = side * 0.08;
      const z = faceZ(x, -0.035) + 0.018;
      head.add(detail(new THREE.TorusGeometry(0.056, 0.007, 8, 24), frame, x, -0.035, z));
      const glass = detail(new THREE.CircleGeometry(0.054, 20), lens, x, -0.035, z - 0.002);
      glass.material = lens;
      glass.visible = false;
      head.add(glass);
    }
    head.add(detail(new THREE.BoxGeometry(0.05, 0.008, 0.008), frame, 0, -0.03, faceZ(0, -0.03) + 0.02));
  }
  if (extras.clip) {
    const clip = detail(new THREE.BoxGeometry(0.07, 0.022, 0.022), toneMat(extras.clip, 0.05), 0.13, 0.1, faceZ(0.13, 0.1) + 0.02);
    clip.rotation.z = 0.55;
    head.add(clip);
  }
  // 머리띠·헤드셋은 귀에서 귀로 머리 위를 넘는 반원이다(토러스 위쪽 절반).
  const arc = (color, tube) => {
    const band = mesh(new THREE.TorusGeometry(R * 1.2, tube, 8, 28, Math.PI), toneMat(color, 0.05), 0, 0.01, 0.01);
    band.rotation.x = -0.25;
    head.add(band);
  };
  if (extras.headband) {
    arc(extras.headband, 0.016);
  }
  if (extras.headset) {
    arc(extras.headset, 0.014);
    const cups = toneMat(extras.headset, 0.05);
    for (const side of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16), cups, side * R * 1.18, -0.01, 0);
      cup.rotation.z = Math.PI / 2;
      head.add(cup);
    }
    const boom = detail(new THREE.CapsuleGeometry(0.008, 0.12, 3, 6), mat("chairBlack"), R * 1.1, -0.1, 0.08);
    boom.rotation.set(0.9, 0, 0.6);
    head.add(boom);
  }
}

// MARK: - 옷

/**
 * 윗옷 — 원화의 옷 종류마다 앞판·깃·단추를 다르게 붙인다. 몸통 자체는 모두 같은 둥근 상자다.
 * 깃·앞판·단추는 선에 가까운 조각이라 외곽선을 두르지 않는다.
 */
function buildTop(body, look, outer, inner, torsoHeight) {
  const front = BODY.torsoDepth / 2 + 0.004;
  const mid = BODY.hip + torsoHeight / 2;
  const top = BODY.shoulder;
  const shade = toneMat(look.top.map((value) => value * 0.82), 0.06);
  const panel = (width, height, y, material = inner, z = front) =>
    body.add(detail(new THREE.BoxGeometry(width, height, 0.006), material, 0, y, z));
  const collar = (material) => {
    for (const side of [-1, 1]) {
      const flap = detail(new THREE.BoxGeometry(0.075, 0.04, 0.012), material, side * 0.04, top - 0.018, front + 0.004);
      flap.rotation.z = side * 0.6;
      body.add(flap);
    }
  };
  const buttons = (x, material) => {
    for (const y of [mid + 0.05, mid, mid - 0.05]) {
      body.add(detail(new THREE.SphereGeometry(0.009, 6, 5), material, x, y, front + 0.004));
    }
  };
  // 밑단 고무단 — 니트 옷의 아랫단이 한 줄 진하다.
  const hem = () => body.add(detail(new THREE.BoxGeometry(BODY.torsoWidth + 0.012, 0.03, BODY.torsoDepth + 0.012), shade, 0, BODY.hip + 0.015, 0));
  switch (look.outfit) {
    case "cardigan":
      panel(0.07, torsoHeight - 0.02, mid);
      collar(inner);
      buttons(-0.045, toneMat([0.45, 0.3, 0.2], 0));
      hem();
      break;
    case "sweater":
      collar(inner);
      hem();
      break;
    case "vest":
      panel(0.09, torsoHeight * 0.42, top - torsoHeight * 0.21);
      collar(inner);
      hem();
      break;
    case "hoodie": {
      panel(0.1, torsoHeight - 0.02, mid);
      const hood = mesh(new THREE.TorusGeometry(0.1, 0.04, 8, 18), outer, 0, top + 0.005, -0.05);
      hood.rotation.x = Math.PI / 2 - 0.35;
      body.add(hood);
      for (const side of [-1, 1]) {
        body.add(detail(new THREE.BoxGeometry(0.008, 0.07, 0.006), inner, side * 0.03, top - 0.05, front + 0.006));
      }
      break;
    }
    case "jacket":
      panel(0.08, torsoHeight - 0.02, mid);
      for (const side of [-1, 1]) {
        const lapel = detail(new THREE.BoxGeometry(0.04, 0.1, 0.01), shade, side * 0.055, top - 0.05, front + 0.004);
        lapel.rotation.z = -side * 0.35;
        body.add(lapel);
      }
      buttons(0.05, shade);
      break;
    case "work":
      collar(outer);
      for (const side of [-1, 1]) {
        body.add(detail(new THREE.BoxGeometry(0.07, 0.06, 0.008), shade, side * 0.07, mid + 0.03, front + 0.004));
      }
      body.add(mesh(roundedBox(BODY.torsoWidth + 0.01, 0.032, BODY.torsoDepth + 0.01), mat("belt"), 0, BODY.hip + 0.016, 0));
      break;
    default:
      break;
  }
}

/** 목에 거는 것 — 사원증 줄·목에 건 헤드폰. */
function neckExtras(body, extras) {
  const front = BODY.torsoDepth / 2 + 0.01;
  if (extras.lanyard) {
    const cord = toneMat(extras.lanyard, 0);
    for (const side of [-1, 1]) {
      const strap = detail(new THREE.BoxGeometry(0.008, 0.11, 0.006), cord, side * 0.022, BODY.shoulder - 0.055, front);
      strap.rotation.z = side * 0.28;
      body.add(strap);
    }
    body.add(detail(new THREE.BoxGeometry(0.045, 0.055, 0.008), mat("paper"), 0, BODY.shoulder - 0.13, front + 0.002));
  }
  if (extras.neckphones) {
    const band = mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 20), toneMat(extras.neckphones, 0.05), 0, BODY.shoulder + 0.015, 0.01);
    band.rotation.x = Math.PI / 2;
    body.add(band);
  }
}

// MARK: - 몸

/**
 * @param {object} look 평면도의 `agentLooks` 한 줄(`cozyAsset` 로 원화를 고른다) 또는 `{cozy: 생김새}`.
 */
export function makeCharacter(look) {
  const cozy = cozyLookFor(look);
  const root = new THREE.Group();
  const body = new THREE.Group();
  const outer = toneMat(cozy.top, 0.06);
  const inner = toneMat(cozy.inner, 0.04);
  const legs = toneMat(cozy.legs, 0.06);
  const hair = toneMat(cozy.hairColor, 0.04);
  const shoes = toneMat(cozy.shoes, 0.04);
  const skin = mat("skinCozy");
  const skirt = cozy.bottom === "skirt";

  // 다리 — 엉덩이 피벗(허벅지) 아래 무릎 피벗(정강이). 원화의 바지는 통이 넓다.
  // 치마를 입으면 다리는 맨살에 흰 양말이고, 치마는 몸통에 붙인다(앉으면 허벅지만 앞으로 꺾인다).
  const thigh = (BODY.hip - BODY.shoe) / 2;
  const thighMaterial = skirt ? skin : legs;
  const shinMaterial = skirt ? mat("paper") : legs;
  const legWidth = skirt ? 0.075 : 0.12;
  const legParts = [-0.068, 0.068].map((x) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(x, BODY.hip, 0);
    hipPivot.add(mesh(roundedBox(legWidth, thigh, legWidth + 0.01), thighMaterial, 0, -thigh / 2, 0));
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    // 정강이를 무릎 위로 조금 겹쳐 올린다 — 딱 맞대면 무릎에 외곽선이 그어져 바지가 두 토막으로 읽힌다.
    knee.add(mesh(roundedBox(legWidth + 0.005, thigh + 0.03, legWidth + 0.015), shinMaterial, 0, -thigh / 2 + 0.015, 0));
    knee.add(mesh(roundedBox(0.105, BODY.shoe, 0.16), shoes, 0, -thigh - BODY.shoe / 2, 0.02));
    hipPivot.add(knee);
    body.add(hipPivot);
    return { hip: hipPivot, knee };
  });
  if (skirt) {
    body.add(mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.12, 20), legs, 0, BODY.hip - 0.035, 0));
  }

  // 몸통 — 니트처럼 모서리를 크게 둥글린다.
  const torsoHeight = BODY.shoulder - BODY.hip;
  body.add(mesh(softBox(BODY.torsoWidth, torsoHeight, BODY.torsoDepth), outer, 0, BODY.hip + torsoHeight / 2, 0));
  buildTop(body, cozy, outer, inner, torsoHeight);
  neckExtras(body, cozy.extras);

  // 팔 — 소매가 도톰하다(원화의 니트 소매). 조끼는 안에 입은 셔츠 소매가 보인다.
  const sleeve = cozy.outfit === "vest" ? inner : outer;
  const armLength = torsoHeight - 0.01;
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (BODY.torsoWidth / 2 + 0.03), BODY.shoulder - 0.035, 0);
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.046, armLength - 0.06, 4, 12), sleeve, 0, -armLength / 2 + 0.01, 0));
    shoulder.add(mesh(new THREE.SphereGeometry(0.04, 12, 10), skin, 0, -armLength - 0.005, 0));
    body.add(shoulder);
    return shoulder;
  });

  body.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 12), skin, 0, BODY.shoulder + 0.01, 0));
  const head = new THREE.Group();
  head.position.y = BODY.headCenter;
  buildFace(head, cozy);
  (HAIR_STYLES[cozy.hair] ?? HAIR_STYLES.short)(head, hair, cozy);
  headExtras(head, cozy.extras);
  body.add(head);

  // 결재 서류 — 방치 2단계부터 오른손 옆에 세워 든다(2D `drawHandPapers` 와 같은 신호). 평소에는 숨긴다.
  // 몸 앞에 들면 줄 선 사람(대표 쪽 = 화면 안쪽을 본다)의 등에 가려 안 보였다 — 옆에 세우면
  // 앞·뒤·옆 어느 방향에서도 보인다.
  const papers = new THREE.Group();
  papers.add(mesh(roundedBox(0.025, 0.22, 0.17), mat("paper"), 0, 0, 0));
  papers.add(mesh(roundedBox(0.012, 0.2, 0.15), mat("bookBlue"), 0.018, 0, 0));
  papers.position.set(BODY.torsoWidth / 2 + 0.08, BODY.hip + 0.02, 0.03);
  papers.visible = false;
  body.add(papers);

  root.add(body);
  root.userData = { body, legs: legParts, arms, papers, head };
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
/**
 * 발 구르기 높이(타일) — 2D `waitTapOffset` 과 같은 리듬: 1.34초마다 0.22초 들었다 0.22초 내린다.
 * 사인파로 계속 흔들면 "걷는 중" 과 구별되지 않는다 — 한 번 구르고 쉬는 박자가 조바심으로 읽힌다.
 */
function tapLift(now) {
  const phase = ((now % 1.34) + 1.34) % 1.34;
  if (phase < 0.22) {
    return phase / 0.22;
  }
  if (phase < 0.44) {
    return 1 - (phase - 0.22) / 0.22;
  }
  return 0;
}

/**
 * 짧은 몸짓(`live.js` 의 `body.cue`) — 끝나면 제자리로 돌아오는 한 번짜리다. 2D 의 `playHop`·
 * 인계받는 사람의 부풀기·거절 흔들림을 같은 박자·같은 폭(타일 40px 기준)으로 옮겼다.
 * 돌려주는 값은 몸을 들어 올릴 높이(타일).
 */
function applyCue(character, figure, body) {
  figure.position.x = 0;
  character.scale.setScalar(1);
  if (!(body.cueRemaining > 0)) {
    return 0;
  }
  const swing = Math.sin((1 - body.cueRemaining / body.cueSeconds) * Math.PI);
  if (body.cue === "hop") {
    return swing * 0.17;
  }
  if (body.cue === "pulse") {
    character.scale.setScalar(1 + swing * 0.12);
  } else if (body.cue === "shake") {
    // 좌우로 두 번 — 한 번 오가는 사인을 네 배로 접는다.
    figure.position.x = Math.sin((1 - body.cueRemaining / body.cueSeconds) * Math.PI * 4) * 0.12;
  }
  return 0;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.slump] 실패 — 고개를 떨구고 손을 책상에서 내린다(2D `startSlump`). 멈춘 자세라
 *   다시 그릴 일이 없다.
 */
export function poseCharacter(character, body, now, { slump = false } = {}) {
  const { body: figure, legs, arms, papers, head } = character.userData;
  const walking = typeof body.pose === "string" && body.pose.includes("walk");
  const slumped = slump && !walking;
  // 평소에도 고개를 살짝 든다 — 카메라가 38° 위에서 내려다봐 곧게 두면 얼굴이 정수리에 가린다.
  head.rotation.x = slumped ? 0.55 : -HEAD_LIFT;
  head.position.set(0, BODY.headCenter - (slumped ? 0.025 : 0), slumped ? 0.035 : 0);
  figure.rotation.x = slumped ? 0.1 : 0;
  const lift = applyCue(character, figure, body);
  // 방치 단계(live.js 의 `body.pressure`) — 2 서류 들기 · 3 발 구르기. 앉아 있으면 표현하지 않는다
  // (줄에 선 사람에게만 붙는 값이다).
  const pressure = body.seated ? 0 : (body.pressure ?? 0);
  if (papers) {
    papers.visible = pressure >= 2;
  }
  const lounging = isLounging(body);
  // 소파는 바라보는 쪽(`facing`)에 있다 — 등을 소파에 대야 하므로 반대로 돌린다.
  const facing = lounging ? OPPOSITE[body.facing] : body.seated ? "down" : body.facing;
  character.rotation.y = FACING_ROTATION[facing] ?? 0;
  if (body.seated) {
    // 엉덩이를 좌판 높이로 내리고, 허벅지는 앞으로·정강이는 아래로. 손은 책상(무릎) 쪽으로.
    figure.position.y = (lounging ? SCALE.sofaSeat : SCALE.chairSeat) + 0.03 - BODY.hip + lift;
    for (const leg of legs) {
      leg.hip.rotation.x = -Math.PI / 2;
      leg.knee.rotation.x = Math.PI / 2;
    }
    for (const arm of arms) {
      arm.rotation.x = slumped ? -0.15 : -0.7;
    }
    return;
  }
  const phase = now * STRIDE_SPEED;
  figure.position.y = (walking ? Math.abs(Math.sin(phase)) * 0.02 : 0) + lift;
  const tap = !walking && pressure >= 3 ? tapLift(now) : 0;
  figure.position.y += tap * 0.03;
  legs.forEach((leg, index) => {
    leg.hip.rotation.x = walking ? Math.sin(phase + index * Math.PI) * STRIDE : 0;
    leg.knee.rotation.x = walking ? Math.max(0, Math.sin(phase + index * Math.PI + 0.6)) * 0.4 : 0;
    // 발 구르기는 오른발만 — 무릎을 굽혀 발끝을 든다.
    if (index === 1 && tap > 0) {
      leg.hip.rotation.x = -0.25 * tap;
      leg.knee.rotation.x = 0.5 * tap;
    }
  });
  arms.forEach((arm, index) => {
    arm.rotation.x = walking ? Math.sin(phase + (index + 1) * Math.PI) * STRIDE * 0.6 : 0;
  });
}
