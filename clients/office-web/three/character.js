// 캐릭터 — 맥 2D 가 쓰는 cozy 원화(`cozy/characters/agent-<번호>.png`)의 직원을 3D 로 옮긴 것.
//
// 처음에는 옛 도트 스프라이트(`sprites/char-*.png`, 54px)의 비율을 재어 만들었는데, 맥 2D 는 이미
// 일러스트 원화로 바뀌어 있어 3D 만 투박한 딴사람이 됐다(사용자 보고: "캐릭터 디자인이 너무 구리다").
// 이제 기준은 원화다 — 큰 머리·큰 눈·볼터치·사람마다 다른 머리 모양과 니트 옷. 누가 어느 원화인지는
// 평면도의 `agentLooks[*].cozyAsset`, 원화별 생김새는 `cozy-looks.js` 가 정한다.
//
// 방향별 그림이 따로 필요 없다 — 몸 하나를 돌리고 팔다리만 움직인다.
import * as THREE from "three";
import { addOutlines, artMat, mat, tone, toneMat, SCALE } from "./style.js";
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

/** Revolve a soft garment contour around its vertical seam. */
function turned(profile, sides = 12) {
  return new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), sides);
}

/** Rounded shoe toe, elongated towards the front of the character. */
function shoeGeometry() {
  return new THREE.SphereGeometry(0.055, 10, 6);
}

/** A curved hair ribbon with a pointed end rather than stacked spherical beads. */
function taperedLock(points, radii, steps = 10, sides = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  const frames = curve.computeFrenetFrames(steps, false);
  const vertices = [];
  const indices = [];
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const segment = Math.min(radii.length - 2, Math.floor(progress * (radii.length - 1)));
    const linear = progress * (radii.length - 1) - segment;
    const blend = linear * linear * (3 - 2 * linear);
    const radius = THREE.MathUtils.lerp(radii[segment], radii[segment + 1], blend);
    const center = curve.getPointAt(progress);
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const offset = frames.normals[step].clone().multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(frames.binormals[step], Math.sin(angle) * radius);
      vertices.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      if (step < steps) {
        const next = step * sides + (side + 1) % sides;
        const here = step * sides + side;
        indices.push(here, next, here + sides, next, next + sides, here + sides);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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
const FACE_SCALE = [1.14, 0.84, 0.92];
const FACE_Y = -0.018;

function faceZ(x, y) {
  const inside = R * R - (x / FACE_SCALE[0]) ** 2 - ((y - FACE_Y) / FACE_SCALE[1]) ** 2;
  return FACE_SCALE[2] * Math.sqrt(Math.max(0, inside));
}

/** Small accessories have no outline or shadow. */
function detail(geometry, material, x = 0, y = 0, z = 0) {
  const node = mesh(geometry, material, x, y, z);
  node.castShadow = false;
  node.userData.noOutline = true;
  return node;
}

function buildFace(head, look) {
  const skin = mat("skinCozy");
  const face = mesh(new THREE.SphereGeometry(R, 20, 12), skin, 0, FACE_Y, 0);
  face.userData.characterPart = "face";
  face.scale.set(...FACE_SCALE);
  head.add(face);
  // 같은 월드 길이에 같은 UV 길이를 준다. 볼을 넓혀도 눈·입을 가로로 늘리지 않는다.
  const decalGeometry = new THREE.SphereGeometry(R + 0.004, 16, 12,
    Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.08, Math.PI * 0.84);
  const positions = decalGeometry.attributes.position;
  const coordinates = decalGeometry.attributes.uv;
  for (let index = 0; index < positions.count; index += 1) {
    coordinates.setXY(index,
      0.5 + positions.getX(index) * FACE_SCALE[0] / 0.4,
      0.5 + (positions.getY(index) * FACE_SCALE[1] + FACE_Y + 0.038) / 0.4);
  }
  const decal = detail(decalGeometry, artMat(look.smile === "open" ? "face-open" : "face-soft"), 0, FACE_Y, 0);
  decal.scale.set(...FACE_SCALE);
  decal.renderOrder = 2;
  head.add(decal);
  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.043, 8, 6), skin, side * R * 1.1, -0.035, -0.012);
    ear.scale.set(0.58, 1, 0.8);
    head.add(ear);
  }
}

/** One continuous hair shell, with an opening across the forehead and cheeks. */
function hairShell(head, hair, length = 0, curly = false) {
  // The crown ends above the forehead, while its sides and back fall behind the cheeks.
  // Remapping the latitude keeps that edge continuous instead of cutting triangles away.
  const shell = new THREE.SphereGeometry(R * 1.1, 20, 12);
  const position = shell.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const longitude = Math.atan2(z, -x);
    const latitude = Math.acos(THREE.MathUtils.clamp(y / (R * 1.1), -1, 1));
    const front = Math.max(0, Math.sin(longitude));
    const endLatitude = Math.PI * (0.7 - 0.39 * front ** 6);
    const mapped = latitude / Math.PI * endLatitude;
    // 곱슬은 두피 표면 자체를 물결치게 한다. 정수리에 따로 꽂은 가닥은 뿔처럼 보인다.
    const ripple = curly ? 0.075 * Math.sin(longitude * 5 + mapped * 7) * Math.sin(mapped) : 0;
    const radius = R * 1.1 * (1 + ripple);
    position.setXYZ(index, -radius * Math.cos(longitude) * Math.sin(mapped),
      radius * Math.cos(mapped), radius * Math.sin(longitude) * Math.sin(mapped));
  }
  shell.computeVertexNormals();
  const cap = mesh(shell, hair, 0, 0.022, -0.015);
  cap.scale.set(1.12, 1.02 + length, 1.01);
  head.add(cap);
}

function strand(head, hair, points, radii, shade = hair) {
  const lock = mesh(taperedLock(points, radii), shade);
  lock.castShadow = false;
  head.add(lock);
}

/** 두께가 있는 매끈한 앞머리. 뿌리는 두피에 묻고 끝만 가늘게 뺀다. */
function fringe(head, hair, swept = false) {
  const paths = [
    [[0.015, 0.2, 0.06], [-0.045, 0.165, 0.13], [-0.12, 0.09, 0.17], [-0.175, 0.065, 0.12]],
    [[0.015, 0.205, 0.055], [0.095, 0.16, 0.13], [0.15, 0.08, 0.16], [0.185, 0.04, 0.105]],
  ];
  for (const points of paths) {
    const lock = mesh(taperedLock(points, [0.01, swept ? 0.058 : 0.05, 0.037, 0.003], 12, 8), hair);
    lock.castShadow = false;
    // 머리 껍질에 닿는 가닥의 내부 경계에는 검은 선을 두르지 않는다.
    lock.userData.noOutline = true;
    head.add(lock);
  }
}

function cheekLocks(head, hair, length = 0.12) {
  for (const side of [-1, 1]) {
    strand(head, hair,
      [[side * 0.205, 0.10, 0.005], [side * 0.231, -0.018, 0.045], [side * 0.191, -length, 0.055]],
      [0.025, 0.048, 0.003]);
  }
}

function tie(head, color, x, y, z, bow) {
  const material = toneMat(color, 0.05);
  const knot = detail(new THREE.SphereGeometry(0.023, 8, 6), material, x, y, z);
  head.add(knot);
  if (bow) {
    for (const side of [-1, 1]) {
      const loop = detail(new THREE.SphereGeometry(0.028, 8, 6), material, x + side * 0.025, y + 0.008, z);
      loop.scale.set(1, 0.55, 0.5);
      head.add(loop);
    }
  }
}

function trailingHair(head, hair, side, length, wave = 0) {
  const lock = mesh(taperedLock(
    [[side * 0.19, 0.015, -0.10], [side * (0.23 + wave), -0.10, -0.08],
      [side * (0.20 - wave), -length + 0.10, -0.055], [side * (0.235 + wave), -length, -0.005]],
    [0.035, 0.073, 0.055, 0.002], 16, 10), hair);
  lock.castShadow = false;
  head.add(lock);
}

/** 곱슬은 구의 표면/법선/인덱스를 직접 이어 한 번에 그린다. */
function curlCluster(head, hair) {
  const vertices = [];
  const normals = [];
  const indices = [];
  const curls = [
    [-0.20, 0.10, 0.015], [-0.16, 0.19, 0.03], [-0.075, 0.232, 0.02],
    [0.025, 0.235, 0.015], [0.12, 0.205, 0.005], [0.205, 0.13, 0.015],
    [-0.23, -0.015, -0.005], [0.23, 0.015, -0.015],
    [-0.12, 0.15, -0.155], [0.075, 0.175, -0.145],
  ];
  curls.forEach(([x, y, z], curlIndex) => {
    const geometry = new THREE.SphereGeometry(0.062 + (curlIndex % 3) * 0.004, 8, 6);
    geometry.scale(1.08, 0.83, 0.92);
    geometry.rotateZ(curlIndex * 0.61);
    geometry.translate(x, y, z);
    const offset = vertices.length / 3;
    vertices.push(...geometry.attributes.position.array);
    normals.push(...geometry.attributes.normal.array);
    indices.push(...Array.from(geometry.index.array, (index) => index + offset));
    geometry.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  const cluster = mesh(geometry, hair);
  cluster.userData.characterPart = "curls";
  head.add(cluster);
}

const HAIR_STYLES = {
  short(head, hair) {
    hairShell(head, hair);
    fringe(head, hair, true);
    cheekLocks(head, hair, 0.06);
  },
  curly(head, hair) {
    hairShell(head, hair, 0, true);
    fringe(head, hair);
    curlCluster(head, hair);
  },
  bob(head, hair) {
    hairShell(head, hair, 0.08);
    fringe(head, hair, true);
    cheekLocks(head, hair, 0.18);
  },
  long(head, hair) {
    hairShell(head, hair, 0.04);
    fringe(head, hair, true);
    cheekLocks(head, hair, 0.2);
    for (const side of [-1, 1]) {
      trailingHair(head, hair, side, 0.36, 0.012);
    }
  },
  ponytail(head, hair, look) {
    hairShell(head, hair);
    fringe(head, hair, true);
    cheekLocks(head, hair, 0.08);
    trailingHair(head, hair, 1, 0.39, 0.03);
    tie(head, look.extras.bow ?? [0.5, 0.6, 0.5], 0.21, -0.09, -0.02, Boolean(look.extras.bow));
  },
  braids(head, hair, look) {
    hairShell(head, hair);
    fringe(head, hair);
    cheekLocks(head, hair, 0.08);
    for (const side of [-1, 1]) {
      trailingHair(head, hair, side, 0.3, 0.02);
      tie(head, look.extras.bow ?? [0.98, 0.78, 0.25], side * 0.23, -0.29, 0.0, false);
    }
  },
  braid(head, hair, look) {
    hairShell(head, hair);
    fringe(head, hair, true);
    cheekLocks(head, hair, 0.11);
    trailingHair(head, hair, 1, 0.38, 0.04);
    tie(head, look.extras.bow ?? [0.7, 0.55, 0.88], 0.25, -0.36, 0.02, true);
  },
  spiky(head, hair) {
    hairShell(head, hair);
    fringe(head, hair);
    cheekLocks(head, hair, 0.05);
    for (const x of [-0.13, -0.045, 0.045, 0.13]) {
      strand(head, hair, [[x, 0.16, -0.02], [x * 1.2, 0.25, 0], [x * 1.45, 0.26, 0.01]], [0.04, 0.035, 0.002]);
    }
  },
};

/** 머리에 붙는 소품 — 안경·핀·머리띠·헤드셋. */
function headExtras(head, extras) {
  if (extras.glasses) {
    const frame = toneMat(extras.glasses, 0);
    const lens = mat("lens");
    for (const side of [-1, 1]) {
      const x = side * 0.08;
      const z = faceZ(x, 0.002) + 0.018;
      head.add(detail(new THREE.TorusGeometry(0.056, 0.007, 5, 12), frame, x, 0.002, z));
      const glass = detail(new THREE.CircleGeometry(0.054, 20), lens, x, 0.002, z - 0.002);
      glass.material = lens;
      glass.visible = false;
      head.add(glass);
    }
    head.add(detail(new THREE.BoxGeometry(0.05, 0.008, 0.008), frame, 0, 0.007, faceZ(0, 0.007) + 0.02));
  }
  if (extras.clip) {
    const clip = detail(new THREE.BoxGeometry(0.07, 0.022, 0.022), toneMat(extras.clip, 0.05), 0.13, 0.1, faceZ(0.13, 0.1) + 0.02);
    clip.rotation.z = 0.55;
    head.add(clip);
  }
  // 머리띠·헤드셋은 귀에서 귀로 머리 위를 넘는 반원이다(토러스 위쪽 절반).
  const arc = (color, tube) => {
    const band = mesh(new THREE.TorusGeometry(R * 1.2, tube, 4, 12, Math.PI), toneMat(color, 0.05), 0, 0.01, 0.01);
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
      const cup = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), cups, side * R * 1.18, -0.01, 0);
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
  const front = BODY.torsoDepth * 0.56;
  const mid = BODY.hip + torsoHeight / 2;
  const top = BODY.shoulder;
  const shade = toneMat(look.top.map((value) => value * 0.82), 0.06);
  const panel = (width, height, y, material = inner) =>
    body.add(detail(new THREE.PlaneGeometry(width, height), material, 0, y, front + 0.004));
  const collar = (material) => {
    for (const side of [-1, 1]) {
      const flap = detail(new THREE.PlaneGeometry(0.07, 0.045), material, side * 0.04, top - 0.025, front + 0.008);
      flap.rotation.z = side * 0.5;
      body.add(flap);
    }
  };
  const buttons = (x, material) => {
    for (const y of [mid + 0.048, mid, mid - 0.048]) {
      body.add(detail(new THREE.SphereGeometry(0.007, 6, 4), material, x, y, front + 0.008));
    }
  };
  const hem = () => {
    const band = detail(turned([[0.14, 0], [0.155, 0.005], [0.155, 0.027], [0.14, 0.032]]), shade, 0, BODY.hip + 0.003, 0);
    band.scale.z = 0.72;
    body.add(band);
    for (const rise of [0.007, 0.019]) {
      const rib = detail(new THREE.TorusGeometry(0.149, 0.002, 3, 18), outer, 0, BODY.hip + rise, 0);
      rib.rotation.x = Math.PI / 2;
      rib.scale.y = 0.72;
      body.add(rib);
    }
  };
  switch (look.outfit) {
    case "cardigan":
      panel(0.065, torsoHeight - 0.03, mid);
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
      panel(0.1, torsoHeight - 0.03, mid);
      const hood = mesh(new THREE.TorusGeometry(0.095, 0.032, 4, 10), outer, 0, top + 0.006, -0.045);
      hood.rotation.x = Math.PI / 2 - 0.35;
      body.add(hood);
      for (const side of [-1, 1]) {
        body.add(detail(new THREE.PlaneGeometry(0.006, 0.07), inner, side * 0.03, top - 0.05, front + 0.01));
      }
      break;
    }
    case "jacket":
      panel(0.075, torsoHeight - 0.03, mid);
      for (const side of [-1, 1]) {
        const lapel = detail(new THREE.PlaneGeometry(0.035, 0.09), shade, side * 0.054, top - 0.05, front + 0.01);
        lapel.rotation.z = -side * 0.35;
        body.add(lapel);
      }
      buttons(0.05, shade);
      break;
    case "work":
      collar(outer);
      for (const side of [-1, 1]) {
        body.add(detail(new THREE.PlaneGeometry(0.065, 0.05), shade, side * 0.07, mid + 0.03, front + 0.01));
      }
      body.add(detail(turned([[0.15, 0], [0.155, 0.005], [0.155, 0.025], [0.15, 0.03]]), mat("belt"), 0, BODY.hip + 0.01, 0));
      break;
    default:
      break;
  }
}

/** 목에 거는 것 — 사원증 줄·목에 건 헤드폰. */
function neckExtras(body, extras) {
  const front = 0.151;
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
    const band = mesh(new THREE.TorusGeometry(0.1, 0.018, 5, 14), toneMat(extras.neckphones, 0.05), 0, BODY.shoulder + 0.015, 0.01);
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

  // Wide, rounded pant legs keep the original hip and knee pivot positions.
  const thigh = (BODY.hip - BODY.shoe) / 2;
  const thighMaterial = skirt ? skin : legs;
  const shinMaterial = skirt ? mat("paper") : legs;
  const legWidth = skirt ? 0.038 : 0.061;
  const legParts = [-0.068, 0.068].map((x) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(x, BODY.hip, 0);
    const upper = mesh(turned([[0.04, -thigh], [legWidth, -thigh + 0.014], [legWidth * 1.06, -0.018], [0.05, 0]]), thighMaterial);
    upper.scale.z = 0.88;
    hipPivot.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    const lower = mesh(turned([[0.045, -thigh - 0.004], [legWidth * 1.08, -thigh + 0.014], [legWidth * 0.96, -0.014], [0.048, 0.02]]), shinMaterial);
    lower.scale.z = 0.91;
    knee.add(lower);
    const shoe = mesh(shoeGeometry(), shoes, 0, -thigh - BODY.shoe / 2 + 0.005, 0.027);
    shoe.scale.set(0.93, 0.45, 1.42);
    knee.add(shoe);
    hipPivot.add(knee);
    body.add(hipPivot);
    return { hip: hipPivot, knee };
  });
  if (skirt) {
    const skirtGeometry = turned([[0.19, 0], [0.195, 0.012], [0.16, 0.1], [0.14, 0.145]], 20);
    const vertices = skirtGeometry.attributes.position;
    for (let index = 0; index < vertices.count; index += 1) {
      const x = vertices.getX(index);
      const z = vertices.getZ(index);
      const fold = 1 + 0.035 * Math.cos(Math.atan2(z, x) * 10) * (1 - vertices.getY(index) / 0.18);
      vertices.setXYZ(index, x * fold, vertices.getY(index), z * fold);
    }
    skirtGeometry.computeVertexNormals();
    const skirtMesh = mesh(skirtGeometry, legs, 0, BODY.hip - 0.045, 0);
    skirtMesh.scale.z = 0.82;
    body.add(skirtMesh);
  }

  const torsoHeight = BODY.shoulder - BODY.hip;
  const torso = mesh(turned([[0.12, 0], [0.147, 0.025], [0.145, 0.075], [0.15, 0.14], [0.149, 0.165], [0.14, 0.19], [0.12, 0.205], [0.09, torsoHeight]]), outer, 0, BODY.hip, 0);
  torso.scale.z = 0.72;
  body.add(torso);
  buildTop(body, cozy, outer, inner, torsoHeight);
  neckExtras(body, cozy.extras);

  const sleeve = cozy.outfit === "vest" ? inner : outer;
  const armLength = torsoHeight - 0.01;
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (BODY.torsoWidth / 2 + 0.022), BODY.shoulder - 0.035, 0);
    const sleeveMesh = mesh(turned([[0.032, -armLength], [0.045, -armLength + 0.018], [0.054, -0.055], [0.05, -0.026], [0.035, -0.008], [0.009, 0]]), sleeve);
    sleeveMesh.rotation.z = -side * 0.08;
    shoulder.add(sleeveMesh);
    const cuff = detail(turned([[0.043, 0], [0.047, 0.005], [0.047, 0.023], [0.041, 0.027]]), toneMat(cozy.top, 0.14), 0, -armLength + 0.01, 0);
    shoulder.add(cuff);
    for (const rise of [0.007, 0.017]) {
      shoulder.add(detail(turned([[0.0475, 0], [0.0475, 0.002]], 8), toneMat(cozy.top, 0.2), 0, -armLength + 0.01 + rise, 0));
    }
    const hand = mesh(new THREE.SphereGeometry(0.037, 10, 8), skin, 0, -armLength - 0.013, 0);
    hand.scale.set(0.82, 0.95, 0.8);
    shoulder.add(hand);
    body.add(shoulder);
    return shoulder;
  });

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
  papers.add(mesh(new THREE.BoxGeometry(0.025, 0.22, 0.17), mat("paper"), 0, 0, 0));
  papers.add(mesh(new THREE.BoxGeometry(0.012, 0.2, 0.15), mat("bookBlue"), 0.018, 0, 0));
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
