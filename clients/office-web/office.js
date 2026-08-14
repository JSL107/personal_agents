// 맥이 계산한 사무실 평면도(layout-*.json)를 그대로 그린다.
//
// **배치 규칙을 여기에 옮겨 적지 않는다.** 좌석이 한 칸이라도 어긋나면 두 화면이 서로 다른
// 사무실이 되므로, 어디에 무엇이 놓이는지는 전부 JSON 이 정하고 이 파일은 "받은 좌표를
// 화면 픽셀로 옮기는 일" 만 한다. 배율·명암·부서색·사람 외형처럼 되계산할 수 없는 값도
// JSON 이 싣는다(Swift 쪽 `OfficeLayoutExport`).
//
// 여기 남은 산술은 **타일 크기에 딸린 것들뿐**이다 — 이름표 크기·문패 높이는 창 크기가
// 정해지기 전에는 값이 나오지 않아 내보낼 수가 없다. 그 계산에 쓰는 상수는 전부
// `metrics` 에서 읽어 맥 앱과 같은 숫자를 본다.
//
// 좌표계가 둘이라는 점만 주의하면 된다 — 평면도는 SpriteKit 기준이라 y 가 **위로** 증가하고,
// Canvas 는 아래로 증가한다. 변환은 `toCanvasY` 한 곳에서만 한다.

const SPRITE_DIR = "sprites";

/** 스프라이트 이름 → Promise<Image|null>. 같은 그림을 두 번 받지 않는다. */
const spriteCache = new Map();

export function loadSprite(name) {
  let cached = spriteCache.get(name);
  if (!cached) {
    cached = new Promise((resolve) => {
      const image = new Image();
      // 에셋이 없으면 그 물건만 빠지고 나머지는 그린다 — 한 장 때문에 화면 전체를 잃지 않는다.
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = `${SPRITE_DIR}/${name}.png`;
    });
    spriteCache.set(name, cached);
  }
  return cached;
}

/** 이미 받아 둔 그림(동기 조회용). 아직 안 왔으면 null. */
const readySprites = new Map();

/** 받은 장수를 돌려준다 — 0 이면 화면이 조용히 텅 비므로 부르는 쪽이 끊을 수 있어야 한다. */
export async function preloadSprites(names) {
  const entries = await Promise.all(
    [...new Set(names)].map(async (name) => [name, await loadSprite(name)])
  );
  let loaded = 0;
  for (const [name, image] of entries) {
    if (image) {
      readySprites.set(name, image);
      loaded += 1;
    }
  }
  return loaded;
}

export function sprite(name) {
  return readySprites.get(name) ?? null;
}

// MARK: - 캐릭터 색 치환

/**
 * 머리색·셔츠색·바지색을 바꿔 찍어낸 캐릭터 그림.
 *
 * 캐릭터 스프라이트가 몇 장뿐이라 서른 명이 전부 같은 사람으로 보인다. 실루엣은 그대로 두고
 * 머리·셔츠·바지 색만 갈아끼우면, 도트 그림에서는 충분히 다른 사람으로 읽힌다.
 *
 * 색 구분은 밝기로 한다(맥 앱 `SpriteLoader.characterTexture` 와 같은 판정):
 *  - 머리 밝기 40~110, 그림 위쪽 45% 안
 *  - 바지 밝기 24 이하, 그림 아래쪽
 *  - 셔츠 밝기 228 이상
 *  - 얼굴은 채도가 있어(26 이상) 건드리지 않는다
 */
const recolorCache = new Map();

function rgbKey(color) {
  return color.map((value) => Math.round(value * 255)).join(",");
}

export function recoloredCharacter(name, look) {
  const image = sprite(name);
  if (!image) {
    return null;
  }
  const key = `${name}|${rgbKey(look.hair)}|${rgbKey(look.shirt)}|${rgbKey(look.pants)}`;
  const cached = recolorCache.get(key);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data;
  // 머리는 그림 위쪽에만 있다. 밝기만으로 가르면 시트에 따라 바지까지 머리로 잡혀
  // 사람마다 바지 색이 제멋대로 바뀐다.
  const hairZoneBottom = Math.floor(canvas.height * 0.45);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      if (pixels[offset + 3] < 16) {
        continue;
      }
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const brightness = Math.floor((red + green + blue) / 3);
      const saturation =
        Math.max(red, green, blue) - Math.min(red, green, blue);
      if (saturation >= 26) {
        continue; // 얼굴·소품처럼 색이 있는 부분은 건드리지 않는다
      }
      let replacement = null;
      // 명암 단계를 정규화할 기준값. 부위마다 원본 밝기 대역이 달라 하나로 나누면
      // 어두운 부위가 통째로 검게 눌린다.
      let shadeDivisor = 1;
      if (brightness >= 40 && brightness <= 110 && y < hairZoneBottom) {
        replacement = look.hair;
        shadeDivisor = 60;
      } else if (brightness >= 228) {
        replacement = look.shirt;
        shadeDivisor = 255;
      } else if (brightness <= 24 && y >= hairZoneBottom) {
        replacement = look.pants;
        shadeDivisor = 17;
      }
      if (!replacement) {
        continue;
      }
      // 원본의 명암 단계를 유지한 채 색만 갈아끼운다 — 통짜로 칠하면 입체감이 사라진다.
      const shade = brightness / shadeDivisor;
      pixels[offset] = clampByte(replacement[0] * 255 * shade);
      pixels[offset + 1] = clampByte(replacement[1] * 255 * shade);
      pixels[offset + 2] = clampByte(replacement[2] * 255 * shade);
    }
  }
  context.putImageData(data, 0, 0);
  recolorCache.set(key, canvas);
  return canvas;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * 캐릭터 그림 파일명 후보를 우선순위대로 만든다.
 *
 * **한 시트를 다 소진한 뒤에 기본 시트로 내려간다.** 순서를 뒤집으면 걸음 그림이 없는 시트의
 * 사람이 걷는 순간 얼굴·체형이 기본 캐릭터로 바뀐다.
 */
export function characterSpriteCandidates(sheet, pose) {
  const still = pose.includes("-walk") ? pose.slice(0, pose.indexOf("-walk")) : pose;
  return [sheet, "char"].flatMap((prefix) =>
    still === pose
      ? [`${prefix}-${pose}`]
      : [`${prefix}-${pose}`, `${prefix}-${still}`]
  );
}

/** 방향 → 그림 자세와 좌우 반전. 원본 side 는 왼쪽을 보고 있다. */
export function characterSpriteFor(facing) {
  switch (facing) {
    case "up":
      return { pose: "up", flipped: false };
    case "left":
      return { pose: "side", flipped: false };
    case "right":
      return { pose: "side", flipped: true };
    default:
      return { pose: "down", flipped: false };
  }
}

// MARK: - 색 유틸

function css(color, alpha = 1) {
  const [red, green, blue] = color.map((value) => Math.round(value * 255));
  return alpha >= 1
    ? `rgb(${red},${green},${blue})`
    : `rgba(${red},${green},${blue},${alpha})`;
}

/**
 * 원본 그림에 단색을 섞은 타일을 만든다(SpriteKit 의 `colorBlendFactor` 와 같은 계산).
 *
 * 결과 = 원본 × (1 - factor) + 색 × factor. `source-atop` 이 정확히 이 식이고, 그림이 투명한
 * 곳은 색이 새지 않는다. 칸마다 새로 만들면 700칸을 매번 합성하게 되므로 조합으로 캐시한다.
 */
const tintCache = new Map();

function tintedTile(image, rgb, factor, size) {
  const key = `${image.src}|${rgbKey(rgb)}|${factor.toFixed(3)}|${size}`;
  const cached = tintCache.get(key);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, size, size);
  context.globalCompositeOperation = "source-atop";
  context.globalAlpha = factor;
  context.fillStyle = css(rgb);
  context.fillRect(0, 0, size, size);
  tintCache.set(key, canvas);
  return canvas;
}

/** 이 칸이 어느 부서 구역 안인가. 벽·바닥에 옅게 태울 색조를 고르는 데 쓴다. */
function zoneAt(x, y, zones) {
  return zones.find(
    (zone) =>
      x >= zone.origin.x &&
      x < zone.origin.x + zone.width &&
      y >= zone.origin.y &&
      y < zone.origin.y + zone.height
  );
}

/** 눌러 놓은 벽의 기본색. 벽 원본이 밝은 크림이라 그대로 깔면 도면처럼 보인다. */
const WALL_BASE_COLOR = [0.26, 0.22, 0.2];
/** 바닥을 배경으로 물릴 때 섞는 중성색. 밝기는 여기가 잡고 부서색은 색조만 준다. */
const FLOOR_BASE_COLOR = [0.17, 0.16, 0.18];

function mixed(base, tint, mix, dim) {
  if (!tint) {
    return base;
  }
  return base.map((value, index) => value * (1 - mix) + tint[index] * dim * mix);
}

export class OfficeRenderer {
  constructor(canvas, layout) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.setLayout(layout);
  }

  setLayout(layout) {
    this.layout = layout;
    this.plan = layout.plan;
    this.metrics = layout.metrics;
    this.seatsByAgent = new Map(
      this.plan.desks.map((desk) => [desk.agentType, desk.seat])
    );
    this.deskByAgent = new Map(
      this.plan.desks.map((desk) => [desk.agentType, desk.desk])
    );
    this.walkable = new Set(
      this.plan.walkable.map((tile) => `${tile.x},${tile.y}`)
    );
    this.measure();
  }

  /**
   * 격자 크기와 화면 크기로 타일 한 칸의 픽셀 크기·격자 원점을 정한다.
   * 관제 화면이라 스크롤을 두지 않고 사무실 전체가 한 화면에 들어가게 맞춘다.
   */
  measure() {
    const { width, height } = this.canvas;
    this.tileSize = Math.min(width / this.plan.columns, height / this.plan.rows);
    this.spriteScale = this.tileSize / this.metrics.referenceTileSize;
    this.characterScale = this.spriteScale * this.metrics.characterScaleFactor;
    this.originX = (width - this.tileSize * this.plan.columns) / 2;
    this.originY = (height - this.tileSize * this.plan.rows) / 2;
  }

  /** SpriteKit y(위로 증가) → Canvas y(아래로 증가). */
  toCanvasY(y) {
    return this.canvas.height - y;
  }

  /** 타일의 바닥 중앙(캐릭터 발이 닿는 지점) — SpriteKit 좌표. */
  floorPoint(tile) {
    return {
      x: this.originX + (tile.x + 0.5) * this.tileSize,
      y: this.originY + tile.y * this.tileSize,
    };
  }

  /** 칸 사이를 걷는 중처럼 소수 좌표도 받는다. */
  floorPointAt(x, y) {
    return {
      x: this.originX + (x + 0.5) * this.tileSize,
      y: this.originY + y * this.tileSize,
    };
  }

  centerPoint(tile) {
    return {
      x: this.originX + (tile.x + 0.5) * this.tileSize,
      y: this.originY + (tile.y + 0.5) * this.tileSize,
    };
  }

  /**
   * 발밑 기준(anchor 0.5, 0)으로 그림 하나를 놓는다. 가구·캐릭터가 모두 이 기준을 쓴다 —
   * 위에서 내려보는 시점에서 물건이 바닥에 닿는 지점이 그 물건의 자리이기 때문이다.
   */
  drawFootAnchored(image, point, width, height, flipX = false) {
    const context = this.context;
    const left = point.x - width / 2;
    const top = this.toCanvasY(point.y + height);
    if (!flipX) {
      context.drawImage(image, left, top, width, height);
      return;
    }
    context.save();
    context.translate(left + width / 2, 0);
    context.scale(-1, 1);
    context.drawImage(image, -width / 2, top, width, height);
    context.restore();
  }

  /** 이 평면도를 그리는 데 필요한 그림 이름 전부. */
  spriteNames(agentLooks) {
    const names = new Set(Object.values(this.layout.floorSprites));
    for (const placement of this.plan.furniture) {
      const info = this.layout.furniture[placement.kind];
      if (info) {
        names.add(info.sprite);
      }
    }
    names.add("desk-paper");
    names.add("char-down");
    for (const [, look] of Object.entries(agentLooks ?? this.layout.agentLooks)) {
      names.add(look.deskProp);
      for (const pose of [
        "sit",
        "down",
        "up",
        "side",
        "down-walk1",
        "down-walk2",
        "up-walk1",
        "up-walk2",
        "side-walk1",
        "side-walk2",
      ]) {
        for (const candidate of characterSpriteCandidates(look.sheet, pose)) {
          names.add(candidate);
        }
      }
    }
    return [...names];
  }

  // MARK: - 한 판 그리기

  /**
   * @param {object} view 지금 화면에 놓을 것들.
   *   `agents` 사람 상태(agentType → {state, bubble, doneToday}),
   *   `bodies` 사람 위치(agentType → {x, y, pose, facing, seated}),
   *   `sessions` 대표 책상에 켤 세션, `hour` 시각(창밖 빛).
   */
  draw(view) {
    const context = this.context;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const light = this.lightFor(view.hour);
    this.drawFloor();
    this.drawWallFixtures(light);
    this.drawFloorDecor();
    this.drawObjects(view);
    // 상태 링은 가구·사람을 다 그린 **뒤에** 얹는다. 좌석이 책상보다 한 칸 위라 책상이
    // 나중에 그려지는데, 링을 사람과 같이 그리면 책상이 링의 아래쪽 절반을 덮어 상태색이
    // 반만 보인다 — 관제 화면에서 가장 먼저 읽혀야 할 신호라 앞으로 올린다.
    this.drawStateRings(view);
    this.drawSessions(view.sessions ?? []);
    this.drawLabels(view);
  }

  /** 지금 시각의 창밖 빛. 어느 시각이 어느 구간인지는 평면도가 싣고 왔다. */
  lightFor(hour) {
    const normalized = ((Math.floor(hour) % 24) + 24) % 24;
    for (const [, info] of Object.entries(this.layout.daylight)) {
      if (info.hours.includes(normalized)) {
        return info;
      }
    }
    return this.layout.daylight.day;
  }

  drawFloor() {
    const tileSize = this.tileSize;
    const { floorSprites, floorMute } = this.layout;
    const context = this.context;
    // 타일 원본은 정사각형이 아니지만(39×41 등) 격자 한 칸에 맞춰 늘려 깐다 — 맥 앱도 같다.
    const drawSize = Math.ceil(tileSize);
    for (let row = 0; row < this.plan.rows; row += 1) {
      for (let column = 0; column < this.plan.columns; column += 1) {
        const kind = this.plan.floor[row][column];
        const image = sprite(floorSprites[kind]);
        if (!image) {
          continue;
        }
        const zone = zoneAt(column, row, this.plan.zones);
        const tint = zone ? this.layout.departmentColors[zone.department] : null;
        const isWall = kind === "wall";
        const color = isWall
          ? mixed(WALL_BASE_COLOR, tint, 0.34, 0.5)
          : mixed(FLOOR_BASE_COLOR, tint, 0.32, 0.55);
        const factor = isWall
          ? this.wallBlendFactor(column, row)
          : floorMute[kind];
        const tile = tintedTile(image, color, factor, 64);
        const center = this.centerPoint({ x: column, y: row });
        const left = center.x - tileSize / 2;
        const top = this.toCanvasY(center.y + tileSize / 2);
        context.save();
        context.translate(left + drawSize / 2, top + drawSize / 2);
        if (!isWall) {
          // 이음선 제거 — 한 칸 걸러 뒤집어 깔면 맞닿는 변이 서로 같은 변이 된다.
          context.scale(column % 2 === 0 ? 1 : -1, row % 2 === 0 ? 1 : -1);
        }
        context.drawImage(tile, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        context.restore();
        if (isWall) {
          this.drawWallEdges(column, row);
        }
      }
    }
  }

  /**
   * 벽 한 칸을 얼마나 누를지. 벽면의 "윗면" 만 덜 눌러 평평한 사각형에 높이감을 준다.
   *
   * 위아래 어느 쪽으로도 벽이 이어지지 않는 한 칸짜리 가로 벽(아래 구역 천장)은 벽면과
   * 윗면이 한 칸에 겹쳐 있어 그 사이 값을 준다.
   */
  wallBlendFactor(column, row) {
    const floor = this.plan.floor;
    const openAbove = row + 1 >= this.plan.rows || floor[row + 1][column] !== "wall";
    const wallBelow = row > 0 && floor[row - 1][column] === "wall";
    if (openAbove && wallBelow) {
      return 0.6;
    }
    if (openAbove) {
      return 0.72;
    }
    return 0.84;
  }

  /**
   * 벽 칸에서 **벽이 아닌 이웃과 맞닿는 변**에 어두운 선을 긋는다.
   *
   * 밝기만으로는 벽이 갈리지 않는다 — 벽이 방 바닥과 복도의 정확히 중간 밝기라 어느 쪽의
   * 연장으로도 읽힌다. 도트 그림에서 면을 가르는 수단은 명도차가 아니라 외곽선이다.
   */
  drawWallEdges(column, row) {
    const tileSize = this.tileSize;
    const context = this.context;
    const thickness = Math.max(1, tileSize * 0.06);
    const center = this.centerPoint({ x: column, y: row });
    const left = center.x - tileSize / 2;
    const top = this.toCanvasY(center.y + tileSize / 2);
    // dy = +1 이 위쪽이다(격자 원점이 아래).
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [-1, 0],
      [1, 0],
    ]) {
      const neighborX = column + dx;
      const neighborY = row + dy;
      const inBounds =
        neighborX >= 0 &&
        neighborX < this.plan.columns &&
        neighborY >= 0 &&
        neighborY < this.plan.rows;
      // 격자 밖은 화면 끝이라 선을 그어도 잘린다 — 벽으로 취급해 건너뛴다.
      if (!inBounds || this.plan.floor[neighborY][neighborX] === "wall") {
        continue;
      }
      const isBottom = dy === -1;
      const lineThickness = isBottom ? thickness * 1.8 : thickness;
      context.fillStyle = `rgba(13,10,13,${isBottom ? 0.72 : 0.9})`;
      if (dx === 0) {
        const edgeTop = dy === 1 ? top : top + tileSize - lineThickness;
        context.fillRect(left, edgeTop, tileSize, lineThickness);
      } else {
        const edgeLeft = dx === -1 ? left : left + tileSize - lineThickness;
        context.fillRect(edgeLeft, top, lineThickness, tileSize);
      }
    }
  }

  /**
   * 창문·벽등, 그리고 창에서 바닥으로 떨어지는 빛.
   *
   * 창은 PNG 가 아니라 코드로 그린다 — **유리 색이 시간대마다 바뀌기 때문**이다. 다섯 장을
   * 따로 두면 색을 손볼 때마다 에셋을 다시 뽑아야 하는데, 창문은 사각형과 반원 몇 개다.
   */
  drawWallFixtures(light) {
    const tileSize = this.tileSize;
    for (const tile of this.plan.windowTiles) {
      this.drawWindow(tile, light);
    }
    if (light.lampLit) {
      for (const tile of this.plan.wallLampTiles) {
        this.drawLampHalo(tile, light);
      }
    }
    for (const tile of this.plan.wallLampTiles) {
      this.drawWallLamp(tile, light.lampLit);
    }
    // 창 아래로 떨어지는 빛기둥. 창이 이어진 묶음마다 한 줄기.
    for (const cluster of this.windowClusters()) {
      this.drawWindowShaft(cluster, light);
    }
    void tileSize;
  }

  /** 가로로 이어진 창을 한 묶음으로 모은다. 낱장마다 빛을 그리면 줄무늬가 된다. */
  windowClusters() {
    const sorted = [...this.plan.windowTiles].sort(
      (left, right) => left.y - right.y || left.x - right.x
    );
    const clusters = [];
    for (const tile of sorted) {
      const last = clusters[clusters.length - 1];
      const previous = last?.[last.length - 1];
      if (previous && previous.y === tile.y && tile.x - previous.x === 1) {
        last.push(tile);
      } else {
        clusters.push([tile]);
      }
    }
    return clusters;
  }

  /**
   * 창문 한 짝. 아치 상단·창살·창턱을 갖춘 세로 두 칸짜리 창.
   *
   * 아치는 반원을 계산해 도트 줄마다 폭을 좁히는 식으로 만든다 — 곡선을 그대로 그리면
   * 경계가 흐려져 다른 스프라이트와 질감이 어긋난다. 도트 격자는 20×40.
   */
  drawWindow(tile, light) {
    const context = this.context;
    const tileSize = this.tileSize;
    const rows = this.metrics.outerWallRows;
    const dot = tileSize / 20; // 가로 20도트
    const base = this.floorPoint(tile);
    const left = base.x - tileSize / 2;
    const bottom = this.toCanvasY(base.y);
    const frame = [0.16, 0.12, 0.1];
    const sill = [0.42, 0.3, 0.21];

    const fill = (x, y, width, height, color) => {
      context.fillStyle = css(color);
      // 도트 좌표는 좌하단 원점 — Canvas 는 위가 0 이라 y 를 뒤집는다.
      context.fillRect(
        left + x * dot,
        bottom - (y + height) * dot,
        width * dot,
        height * dot
      );
    };

    const glassBottom = 4;
    const archBase = 24;
    const glassTop = 30;
    const centerX = 10;
    const radius = 7;
    const halfDots = (row) => {
      if (row <= archBase) {
        return Math.round(radius);
      }
      const height = row - archBase;
      const squared = radius * radius - height * height;
      return Math.round(squared > 0 ? Math.sqrt(squared) : 0);
    };

    for (let row = glassBottom; row <= glassTop; row += 1) {
      const half = halfDots(row);
      if (half < 1) {
        continue;
      }
      const glassLeft = centerX - half;
      const width = half * 2;
      // 하늘색은 위아래를 잇는 계조. 픽셀아트라 연속 그라데이션 대신 줄 단위로 섞는다.
      const ratio = (row - glassBottom) / (glassTop - glassBottom);
      const color = light.skyLow.map(
        (value, index) => value * (1 - ratio) + light.skyHigh[index] * ratio
      );
      fill(glassLeft, row, width, 1, color);
      fill(glassLeft - 1, row, 1, 1, frame);
      fill(glassLeft + width, row, 1, 1, frame);
    }
    // 아치 꼭대기 마감 — 반원 계산만으로는 맨 윗줄이 뾰족하게 끊긴다.
    const topWidth = halfDots(glassTop) * 2;
    fill(centerX - Math.floor(topWidth / 2), glassTop + 1, topWidth, 1, frame);
    // 창살 — 세로 하나로 두 짝 창, 가로 둘로 네 짝 창처럼 나눈다.
    fill(centerX, glassBottom, 1, glassTop - glassBottom + 1, frame);
    fill(3, archBase, 15, 1, frame);
    fill(3, Math.floor((glassBottom + archBase) / 2), 15, 1, frame);
    // 창턱 — 아래에 밝은 띠를 두면 창이 벽에 붙어 있는 물건으로 읽힌다.
    fill(2, glassBottom - 2, 17, 2, sill);
    fill(2, glassBottom - 3, 17, 1, frame);
    void rows;
  }

  /** 벽등 한 칸. 브래킷 + 등피, 켜지면 등피가 노랗게 빛난다. */
  drawWallLamp(tile, lit) {
    const context = this.context;
    const tileSize = this.tileSize;
    const dot = tileSize / 20;
    const base = this.floorPoint(tile);
    const left = base.x - tileSize / 2;
    const bottom = this.toCanvasY(base.y);
    const metal = [0.3, 0.26, 0.22];
    // 꺼진 등은 벽보다 **어두워야** 형태가 남는다. 중간 회색이면 벽면 밝기와 겹쳐 사라진다.
    const shade = lit ? [1.0, 0.84, 0.46] : [0.21, 0.2, 0.19];
    const shadeEdge = lit ? [0.86, 0.58, 0.24] : [0.13, 0.12, 0.12];
    const fill = (x, y, width, height, color) => {
      context.fillStyle = css(color);
      context.fillRect(
        left + x * dot,
        bottom - (y + height) * dot,
        width * dot,
        height * dot
      );
    };
    fill(9, 15, 2, 4, metal);
    fill(8, 18, 4, 1, metal);
    fill(8, 13, 4, 2, shadeEdge);
    fill(7, 11, 6, 2, shade);
    fill(6, 9, 8, 2, shade);
    fill(6, 8, 8, 1, shadeEdge);
    if (lit) {
      // 켜졌을 때만 심지 쪽에 흰 점을 둔다 — 갓 전체를 밝히는 것보다 광원이 또렷하다.
      fill(9, 10, 2, 2, [1, 0.98, 0.9]);
    }
  }

  /** 벽등 주위로 퍼지는 빛무리. 빛은 물체가 아니라 공기의 밝기라 부드럽게 깐다. */
  drawLampHalo(tile, light) {
    const context = this.context;
    const point = this.floorPoint(tile);
    const center = {
      x: point.x,
      y: this.toCanvasY(point.y + this.tileSize * 0.55),
    };
    const radius = this.tileSize * 1.5;
    const gradient = context.createRadialGradient(
      center.x,
      center.y,
      0,
      center.x,
      center.y,
      radius
    );
    gradient.addColorStop(0, css(light.glow, 0.34));
    gradient.addColorStop(0.45, css(light.glow, 0.15));
    gradient.addColorStop(1, css(light.glow, 0));
    context.save();
    // 밝은 쪽에 더하는 합성이라 **어두운 곳은 어두운 채로 남는다** — 색막이 화면 전체를
    // 세피아로 만들던 것과 정반대다.
    context.globalCompositeOperation = "lighter";
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  /**
   * 창에서 바닥으로 떨어지는 빛. 아래로 갈수록 넓어지고 옅어진다.
   *
   * 창 쪽에 밝기를 몰아 준다 — 선형으로 깔면 바닥 끝까지 허옇게 남는다.
   */
  drawWindowShaft(cluster, light) {
    if (light.glowStrength <= 0) {
      return;
    }
    const context = this.context;
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    const spanWidth = (last.x - first.x + 1) * this.tileSize;
    const centerX =
      (this.floorPoint(first).x + this.floorPoint(last).x) / 2;
    const topY = this.toCanvasY(this.floorPoint(first).y);
    const height = this.tileSize * 4.5;
    const gradient = context.createLinearGradient(0, topY, 0, topY + height);
    gradient.addColorStop(0, css(light.glow, light.glowStrength));
    gradient.addColorStop(1, css(light.glow, 0));
    context.save();
    context.globalCompositeOperation = "lighter";
    context.fillStyle = gradient;
    context.beginPath();
    // 창 쪽이 좁고 아래로 벌어지는 사다리꼴.
    context.moveTo(centerX - spanWidth * 0.4, topY);
    context.lineTo(centerX + spanWidth * 0.4, topY);
    context.lineTo(centerX + spanWidth * 0.8, topY + height);
    context.lineTo(centerX - spanWidth * 0.8, topY + height);
    context.closePath();
    context.fill();
    context.restore();
  }

  /**
   * 바닥 깔개. 가구·사람보다 **뒤에** 그린다 — 앞뒤를 y 로 정하는 구조에서 깔개는 자기보다
   * 위 칸에 놓인 소파까지 덮어 버린다.
   */
  drawFloorDecor() {
    for (const placement of this.plan.furniture) {
      const info = this.layout.furniture[placement.kind];
      if (info?.floorDecor) {
        this.drawFurniturePiece(placement, info);
      }
    }
  }

  /**
   * 가구와 사람을 **아래쪽부터** 그린다. 화면 아래에 있을수록 앞이라, 탑다운에서 앞뒤가
   * 뒤집히지 않는다. 좌석은 책상보다 한 칸 위라 이 규칙만으로 책상이 사람 하반신을 가린다.
   */
  drawObjects(view) {
    const pieces = [];
    for (const placement of this.plan.furniture) {
      const info = this.layout.furniture[placement.kind];
      if (info && !info.floorDecor) {
        pieces.push({ y: placement.tile.y, kind: "furniture", placement, info });
      }
    }
    for (const [agentType, body] of Object.entries(view.bodies ?? {})) {
      pieces.push({ y: body.y, kind: "character", agentType, body });
    }
    if (this.plan.presidentTile) {
      pieces.push({
        y: this.plan.presidentTile.y,
        kind: "president",
        tile: this.plan.presidentTile,
      });
    }
    // 같은 줄이면 가구를 먼저 — 사람이 가구 앞에 서야 상호작용으로 읽힌다.
    pieces.sort(
      (left, right) =>
        right.y - left.y ||
        (left.kind === "furniture" ? -1 : 1) - (right.kind === "furniture" ? -1 : 1)
    );
    for (const piece of pieces) {
      if (piece.kind === "furniture") {
        this.drawFurniturePiece(piece.placement, piece.info);
        this.drawDeskExtras(piece.placement, view);
      } else if (piece.kind === "character") {
        this.drawCharacter(piece.agentType, piece.body);
      } else {
        this.drawPresident(piece.tile);
      }
    }
  }

  drawFurniturePiece(placement, info) {
    const image = sprite(info.sprite);
    if (!image) {
      return;
    }
    const scale = this.spriteScale * info.sizeBoost;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const point = this.floorPoint(placement.tile);
    if (info.wallMounted) {
      // 벽에 거는 물건은 바닥선이 아니라 벽면 중턱에 걸린다.
      point.y += this.tileSize * this.metrics.wallMountLiftTiles;
    }
    // 두 칸 이상을 차지하는 가구는 기준 칸 중앙이 아니라 **점유 범위 중앙**에 놓는다.
    point.x += (this.tileSize * (info.footprintWidth - 1)) / 2;
    this.drawFootAnchored(image, point, width, height);
  }

  /**
   * 책상 위 — 오늘 처리한 서류 더미, 개인 소품, 일하는 중이면 켜진 모니터.
   *
   * 서류는 승인 대기처럼 "손이 필요한" 신호가 아니라 하루의 흐름을 보여주는 배경 정보다.
   * 건수가 두 배로 늘 때마다 한 장 올라간다 — 선형으로 하면 하루 20건 도는 사람만 늘
   * 최대치에 붙어 "조금 바쁨" 과 "매우 바쁨" 이 같은 그림이 된다.
   */
  drawDeskExtras(placement, view) {
    if (placement.kind !== "desk") {
      return;
    }
    const owner = this.ownerOfDesk(placement.tile);
    if (!owner) {
      return;
    }
    const agent = view.agents?.[owner];
    const look = this.layout.agentLooks[owner];
    const tileSize = this.tileSize;
    const base = this.floorPoint(placement.tile);
    const metrics = this.metrics;

    // 켜진 모니터 — 지금 일하는 중일 때만. 책상 스프라이트 안에서 화면이 차지하는 자리는
    // 비율로 잡는다(책상만 sizeBoost 로 따로 키우기 때문에 타일 배수로는 어긋난다).
    if (agent?.state === "IN_PROGRESS") {
      const deskInfo = this.layout.furniture.desk;
      const image = sprite(deskInfo.sprite);
      if (image) {
        const scale = this.spriteScale * deskInfo.sizeBoost;
        const deskWidth = image.naturalWidth * scale;
        const deskHeight = image.naturalHeight * scale;
        const width = deskWidth * metrics.deskScreenWidthRatio;
        const height = deskHeight * metrics.deskScreenHeightRatio;
        const bottom = deskHeight * metrics.deskScreenBottomRatio;
        this.context.fillStyle = `rgba(148,225,255,${0.55 + 0.35 * view.blink})`;
        this.context.fillRect(
          base.x - width / 2,
          this.toCanvasY(base.y + bottom + height),
          width,
          height
        );
      }
    }

    // 개인 소품 — 사람이 서른인데 책상이 전부 똑같아 자리가 복사한 듯 같아 보였다.
    const propImage = look ? sprite(look.deskProp) : null;
    if (propImage) {
      this.drawFootAnchored(
        propImage,
        {
          x: base.x + tileSize * metrics.deskPropOriginTiles[0],
          y: base.y + tileSize * metrics.deskPropOriginTiles[1],
        },
        propImage.naturalWidth * this.spriteScale,
        propImage.naturalHeight * this.spriteScale
      );
    }

    const paperImage = sprite("desk-paper");
    const count = paperCount(agent?.doneToday, metrics.deskPaperMaxCount);
    if (!paperImage || count === 0) {
      return;
    }
    const originX = base.x + tileSize * metrics.deskPaperOriginTiles[0];
    const originY = base.y + tileSize * metrics.deskPaperOriginTiles[1];
    for (let index = 0; index < count; index += 1) {
      // 한 장씩 위로 쌓고 좌우로 번갈아 어긋낸다 — 자로 맞춰 쌓으면 한 장처럼 보인다.
      // 어긋내는 폭을 위로 갈수록 넓혀 더미의 **가로 폭**이 장수에 따라 자라게 한다.
      const jitter = index % 2 === 0 ? 1 : -1;
      const spread =
        metrics.deskPaperJitterTiles *
        (1 + index * metrics.deskPaperSpreadGrowth);
      this.drawFootAnchored(
        paperImage,
        {
          x: originX + tileSize * spread * jitter,
          y: originY + tileSize * index * metrics.deskPaperStepTiles,
        },
        paperImage.naturalWidth * this.spriteScale,
        paperImage.naturalHeight * this.spriteScale
      );
    }
  }

  ownerOfDesk(tile) {
    if (!this.deskOwners) {
      this.deskOwners = new Map(
        this.plan.desks.map((desk) => [`${desk.desk.x},${desk.desk.y}`, desk.agentType])
      );
    }
    return this.deskOwners.get(`${tile.x},${tile.y}`) ?? null;
  }

  /**
   * 사람 하나 — 발밑 상태 링 + 몸 + (라벨은 나중에 한꺼번에).
   *
   * 상태색을 몸에 칠하지 않고 발밑 링으로 빼는 이유는, 픽셀 캐릭터를 상태색으로 물들이면
   * 부서 구분(옷 색)과 상태 구분이 같은 채널에서 싸우기 때문이다.
   */
  /**
   * 발밑 상태 링 — 바닥에 눕힌 타원이라 캐릭터를 가리지 않는다.
   *
   * 상태색을 몸에 칠하지 않고 링으로 빼는 이유는, 픽셀 캐릭터를 상태색으로 물들이면
   * 부서 구분(옷 색)과 상태 구분이 같은 채널에서 싸우기 때문이다. 손이 필요한 두 상태
   * (승인 대기·실패)는 선을 더 굵게 준다.
   */
  drawStateRings(view) {
    const context = this.context;
    const tileSize = this.tileSize;
    const radiusX = tileSize * 0.34;
    const radiusY = tileSize * 0.17;
    for (const [agentType, body] of Object.entries(view.bodies ?? {})) {
      const state = view.agents?.[agentType]?.state ?? "WAITING";
      const color = this.layout.stateColors[state] ?? this.layout.stateColors.WAITING;
      const point = this.floorPointAt(body.x, body.y);
      context.save();
      context.strokeStyle = css(color, 0.95);
      context.lineWidth =
        state === "AWAITING_APPROVAL" || state === "FAILED" ? 3.2 : 2.2;
      context.beginPath();
      context.ellipse(
        point.x,
        this.toCanvasY(point.y + radiusY * 0.4),
        radiusX,
        radiusY,
        0,
        0,
        Math.PI * 2
      );
      context.stroke();
      context.restore();
    }
  }

  drawCharacter(agentType, body) {
    const look = this.layout.agentLooks[agentType];
    if (!look) {
      return;
    }
    const point = this.floorPointAt(body.x, body.y);
    const { pose, flipped } = body.seated
      ? { pose: "sit", flipped: false }
      : characterSpriteFor(body.facing ?? "down");
    const posed = body.seated ? "sit" : body.pose ?? pose;
    const image = this.characterImage(look, posed);
    if (!image) {
      return;
    }
    // 앉으면 책상 쪽으로 내려 하반신이 책상에 가리게 한다. 안 내리면 좌석이 책상 바로 위
    // 칸이라 사람이 책상 위 허공에 별개로 놓인 물체처럼 보인다.
    const drop = body.seated ? this.tileSize * this.metrics.seatedSpriteDrop : 0;
    this.drawFootAnchored(
      image,
      { x: point.x, y: point.y - drop },
      image.width * this.characterScale,
      image.height * this.characterScale,
      flipped
    );
  }

  /** 그 사람의 색으로 치환한 그림. 시트에 그 자세가 없으면 기본 시트로 내려간다. */
  characterImage(look, pose) {
    for (const candidate of characterSpriteCandidates(look.sheet, pose)) {
      const recolored = recoloredCharacter(candidate, look);
      if (recolored) {
        return recolored;
      }
    }
    return null;
  }

  /** "나(대표)" — 승인 줄의 기준점이면서 담당자를 정하지 않은 지시의 입구다. */
  drawPresident(tile) {
    const image = sprite("char-down");
    if (!image) {
      return;
    }
    const point = this.floorPoint(tile);
    this.drawFootAnchored(
      image,
      point,
      image.naturalWidth * this.characterScale,
      image.naturalHeight * this.characterScale
    );
  }

  /**
   * 대표 책상에 켜지는 로컬 편집기 세션.
   *
   * 세션은 대표가 직접 띄운 창이라 **사람으로 세우지 않는다** — 창 하나당 사람을 세웠더니
   * 없던 직원이 생겼다 사라지는 화면이 됐다. 대신 책상 위에서 화면이 켜진다.
   */
  drawSessions(sessions) {
    const desks = this.layout.sessionDesks ?? [];
    const context = this.context;
    const tileSize = this.tileSize;
    const fontSize = Math.max(
      this.metrics.nameplateMinFontSize,
      tileSize * this.metrics.nameplateFontTiles * 0.8
    );
    sessions.slice(0, desks.length).forEach((session, index) => {
      const desk = desks[index];
      const point = this.floorPoint(desk);
      if (session.active) {
        context.fillStyle = "rgba(148,230,255,0.9)";
        context.fillRect(
          point.x - tileSize * 0.17,
          this.toCanvasY(point.y + tileSize * 0.81),
          tileSize * 0.34,
          tileSize * 0.22
        );
      }
      // 이름은 **책상 아래**. 위는 바깥벽이고 그 높이에 대표 이름표가 있어 겹친다.
      // 판을 깔지 않는다 — 대표실 책상 넷이 나란히라 판이 이어지면 한 덩어리로 읽힌다.
      context.save();
      context.font = this.labelFont(fontSize);
      context.textAlign = "center";
      // 글자 **밑선**을 그 높이에 둔다 — 맥 앱의 라벨도 밑선 기준이라, 윗변으로 맞추면
      // 글자 높이만큼 통째로 내려가 책상에서 멀어진다.
      context.textBaseline = "alphabetic";
      const available = tileSize * 1.9;
      const width = context.measureText(session.label).width;
      // 글자 수 상한은 평균 글자 폭에서 나오므로 넘치는 이름이 있다(대문자가 이어지는
      // 디렉터리명). 그려 본 폭으로 한 번 더 눌러 옆자리를 침범하지 않게 한다.
      const squeeze = width > available ? available / width : 1;
      context.translate(point.x, this.toCanvasY(point.y - tileSize * 0.24));
      context.scale(squeeze, 1);
      context.lineWidth = 3;
      context.strokeStyle = "rgba(8,8,8,0.9)";
      context.strokeText(session.label, 0, 0);
      context.fillStyle = session.active ? "rgb(242,242,242)" : "rgb(153,153,153)";
      context.fillText(session.label, 0, 0);
      context.restore();
    });
  }

  // MARK: - 라벨 (이름표 · 말풍선 · 문패)

  /**
   * 글자는 전부 마지막에 그린다 — 가구·사람보다 앞이어야 읽힌다.
   *
   * 순서가 중요하다. 문패가 이름표를 덮으면 그 방 가운데 좌석의 이름이 통째로 사라지므로,
   * 문패 높이는 그 방 **첫 좌석 머리 위 말풍선**에서 파생한다(맥 앱과 같은 계산).
   */
  drawLabels(view) {
    for (const [agentType, body] of Object.entries(view.bodies ?? {})) {
      this.drawNameplate(agentType, body, view);
    }
    // 밴드 이름표는 부서 문패가 이미 차지한 가로 구간을 피한다 — 밴드와 부서는 열 수에 따라
    // 서로 다른 격자로 나뉘어, 고정 정렬은 3열에서만 우연히 떨어지고 2열에서 다시 만난다.
    this.drawCommonAreaLabels(this.drawZoneLabels());
    this.drawPresidentLabel();
  }

  nameplateFontSize() {
    return Math.max(
      this.metrics.nameplateMinFontSize,
      this.tileSize * this.metrics.nameplateFontTiles
    );
  }

  bubbleFontSize() {
    return Math.max(
      this.metrics.nameplateMinFontSize,
      this.tileSize * this.metrics.bubbleFontTiles
    );
  }

  labelFont(size) {
    // 맥 앱이 쓰는 굵은 고딕을 먼저 찾고, 없는 환경(윈도우)에서는 같은 계열로 내려간다.
    return `bold ${size}px "${this.metrics.labelFontName}", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  }

  /**
   * 이름표. 판을 옅게 깔고 글자에 어두운 외곽선을 줘 판 없이도 읽히게 한다.
   *
   * 서른 명 전원이 늘 진한 검은 딱지를 달고 있으면 방이 라벨로 덮여 상태 링을 볼 수 없다.
   * 기본은 옅게 두고 두 경우만 올린다 — 손이 필요한 대상(승인 대기·실패)과 일이 도는 사람.
   */
  drawNameplate(agentType, body, view) {
    const look = this.layout.agentLooks[agentType];
    if (!look) {
      return;
    }
    const agent = view.agents?.[agentType];
    const state = agent?.state ?? "WAITING";
    const emphasized = state === "AWAITING_APPROVAL" || state === "FAILED";
    // 창이 작아 이름표가 서로 겹치는 구간에서는 겹친 글자 서른 개보다 **읽히는 몇 개**가 낫다.
    if (
      this.tileSize < this.metrics.nameplateCrowdedTileSize &&
      !emphasized &&
      state !== "IN_PROGRESS"
    ) {
      return;
    }
    const fontSize = this.nameplateFontSize();
    const point = this.floorPointAt(body.x, body.y);
    const drop = body.seated ? this.tileSize * this.metrics.seatedSpriteDrop : 0;
    const spriteHeight = this.characterHeight(look, body);
    const bottomY =
      point.y - drop + spriteHeight + this.tileSize * this.metrics.nameplateGapTiles;
    // 자리 몫은 좌석에 앉아 있을 때만 물린다 — 자리를 떠난 사람에게 물리면 복도에서도
    // 이름표가 한쪽으로 치우친 채 눌려 따라다닌다.
    const span = body.seated ? this.nameplateSpan(body) : null;
    this.drawPlateLabel(look.roleLabel, {
      centerX: point.x,
      bottomY,
      fontSize,
      alpha: emphasized ? 0.72 : 0.38,
      textAlpha: emphasized ? 1 : 0.84,
      span,
    });

    // 말풍선은 이름표보다 한 층 더 위다. 아래를 고정하고 위로 자라게 해야 두 줄이 될 때
    // 사람 머리와 이름표를 덮지 않는다.
    const bubble = agent?.bubble;
    if (!bubble || state === "WAITING") {
      return;
    }
    const clearance =
      fontSize +
      this.tileSize * this.metrics.nameplateGapTiles +
      this.metrics.nameplateClearancePadding;
    this.drawPlateLabel(bubble, {
      centerX: point.x,
      bottomY: point.y - drop + spriteHeight + clearance,
      fontSize: this.bubbleFontSize(),
      alpha: 0.62,
      textAlpha: 1,
      span,
      maxLines: this.metrics.bubbleMaxLines,
    });
  }

  characterHeight(look, body) {
    const image = this.characterImage(look, body.seated ? "sit" : body.pose ?? "down");
    return image
      ? image.height * this.characterScale
      : this.tileSize * this.metrics.seatedSpriteTiles;
  }

  /**
   * 좌석 이름표가 좌우로 쓸 수 있는 여유(px). 좌석 중심에서 왼쪽·오른쪽 각각.
   *
   * 이름표는 늘 좌석 중앙에 놓이는데 폭은 이름 길이와 창 크기가 정한다. 자리보다 넓어지면
   * 갈 곳이 없어 두 방향으로 샌다 — 옆자리 이름표를 덮거나 방 벽과 문 위로 넘어간다.
   * 좌우 이웃과는 중간선까지, 이웃이 없으면 방 안쪽 벽까지를 자기 몫으로 준다.
   */
  nameplateSpan(body) {
    const seat = { x: Math.round(body.x), y: Math.round(body.y) };
    const zone = zoneAt(seat.x, seat.y, this.plan.zones);
    if (!zone) {
      return null;
    }
    const center = seat.x + 0.5;
    let left = zone.origin.x + 1;
    let right = zone.origin.x + zone.width - 1;
    // 문 열도 경계다 — 판이 문 위로 밀리면 문짝 무늬와 글자가 겹쳐 둘 다 안 읽힌다.
    const door = zone.origin.x + (zone.width - 2);
    if (center > door + 1) {
      left = Math.max(left, door + 1);
    }
    if (center < door) {
      right = Math.min(right, door);
    }
    const neighborGap =
      this.metrics.labelSeparationMinPixels / 2 / Math.max(this.tileSize, 1);
    const sameRow = this.plan.desks
      .map((desk) => desk.seat)
      .filter(
        (other) =>
          other.y === seat.y &&
          other.x !== seat.x &&
          zoneAt(other.x, other.y, this.plan.zones) === zone
      );
    const leftNeighbors = sameRow.filter((other) => other.x < seat.x);
    if (leftNeighbors.length > 0) {
      const nearest = Math.max(...leftNeighbors.map((other) => other.x));
      left = Math.max(left, (nearest + 0.5 + center) / 2 + neighborGap);
    }
    const rightNeighbors = sameRow.filter((other) => other.x > seat.x);
    if (rightNeighbors.length > 0) {
      const nearest = Math.min(...rightNeighbors.map((other) => other.x));
      right = Math.min(right, (nearest + 0.5 + center) / 2 - neighborGap);
    }
    return {
      left: Math.max(0, center - left) * this.tileSize,
      right: Math.max(0, right - center) * this.tileSize,
    };
  }

  /**
   * 판 위에 글자 한 덩어리를 놓는다. 자리 몫(`span`)이 있으면 그 안에 넣는다 —
   * 넘치면 옆으로 밀고, 그래도 넘치면 가로로 눌러 넣는다.
   *
   * **판 여백은 눌리지 않는다.** 배율은 글자에만 걸리므로 판 전체가 눌린다고 보고 계산하면
   * 실제 판이 몫을 여백 × (1 - 배율) 만큼 넘는다. 몫에서 여백을 먼저 떼고 남은 폭에 맞춘다.
   */
  drawPlateLabel(text, options) {
    const context = this.context;
    const {
      centerX,
      bottomY,
      fontSize,
      alpha = 0.5,
      textAlpha = 1,
      span = null,
      maxLines = 1,
      maxWidth = null,
      textColor = null,
      borderColor = null,
      padding = this.metrics.nameplatePlatePadding,
    } = options;
    context.save();
    context.font = this.labelFont(fontSize);
    context.textBaseline = "alphabetic";
    context.textAlign = "center";

    const available =
      maxWidth ?? (span ? span.left + span.right : Number.POSITIVE_INFINITY);
    const lines = wrapText(context, text, available, maxLines);
    const widest = Math.max(...lines.map((line) => context.measureText(line).width));
    let scaleX = 1;
    let offsetX = 0;
    if (span && span.left + span.right > padding) {
      const usable = span.left + span.right - padding;
      scaleX = widest > usable ? usable / widest : 1;
      const half = (widest * scaleX + padding) / 2;
      offsetX = Math.min(Math.max(0, half - span.left), span.right - half);
    }
    const lineHeight = fontSize * this.metrics.labelBoxRatio;
    const boxWidth = widest * scaleX + padding;
    const boxHeight = lineHeight * lines.length;
    const boxLeft = centerX + offsetX - boxWidth / 2;
    const boxTop = this.toCanvasY(bottomY) - boxHeight;

    context.fillStyle = `rgba(18,18,18,${alpha})`;
    roundRect(context, boxLeft, boxTop, boxWidth, boxHeight, 3);
    context.fill();
    if (borderColor) {
      context.strokeStyle = css(borderColor, 0.55);
      context.lineWidth = 1;
      context.stroke();
    }

    context.translate(centerX + offsetX, 0);
    context.scale(scaleX, 1);
    lines.forEach((line, index) => {
      const baseline = boxTop + lineHeight * (index + 1) - fontSize * 0.28;
      // 채움 + 외곽선. 바닥·가구 무늬 위에서도 글자가 뭉개지지 않는다.
      context.lineWidth = 3.5;
      context.strokeStyle = "rgba(8,8,8,0.95)";
      context.strokeText(line, 0, baseline);
      context.fillStyle = textColor
        ? css(textColor, textAlpha)
        : `rgba(255,255,255,${textAlpha})`;
      context.fillText(line, 0, baseline);
    });
    context.restore();
  }

  /**
   * 부서 문패. 구역 위쪽에 얹되 **그 방 첫 좌석 머리 위 말풍선보다 위**에 둔다.
   *
   * 문패는 겹치면 이기는 쪽이라, 구역 정중앙(칸 5.5)에 좌석이 1·3·5·7 이면 매번 같은
   * 사람(세 번째 좌석)의 글자가 통째로 사라진다.
   */
  drawZoneLabels() {
    const context = this.context;
    const fontSize = Math.max(
      this.metrics.zoneLabelMinFontSize,
      this.tileSize * 0.38
    );
    const occupied = [];
    for (const zone of this.plan.zones) {
      const [icon, label] = this.layout.departmentLabels[zone.department] ?? ["", ""];
      const text = `${icon} ${label}`;
      context.save();
      context.font = this.labelFont(fontSize);
      const width = context.measureText(text).width + 12;
      context.restore();

      // **구역 정중앙에 고정한다.** 문패끼리는 피하지 않는다 — 위아래 방이 같은 가로 범위를
      // 쓰므로 서로 피하게 하면 아래 세 방이 통째로 옆으로 밀려 어느 방 문패인지 흐려진다.
      // 밴드 이름표만 이 구간을 피한다.
      const centerX = this.originX + (zone.origin.x + zone.width / 2) * this.tileSize;
      occupied.push([centerX - width / 2, centerX + width / 2]);

      const bottomTiles = this.zoneLabelBottomTiles(zone, this.topSeatY(zone));
      this.drawPlateLabel(text, {
        centerX,
        bottomY: this.originY + bottomTiles * this.tileSize,
        fontSize,
        alpha: 0.78,
        // 글자에 부서색을 준다 — 문패를 읽지 않고 색만으로도 어느 방인지 갈린다.
        textColor: this.layout.departmentColors[zone.department],
        borderColor: this.layout.departmentColors[zone.department],
        padding: 12,
      });
    }
    return occupied;
  }

  topSeatY(zone) {
    const seats = this.plan.desks
      .map((desk) => desk.seat)
      .filter((seat) => zoneAt(seat.x, seat.y, this.plan.zones) === zone);
    return seats.length > 0 ? Math.max(...seats.map((seat) => seat.y)) : null;
  }

  /** 문패 아래끝 높이(격자 칸). 좌석이 없는 구역이면 경계 줄 바로 위. */
  zoneLabelBottomTiles(zone, topSeatY) {
    const boundary =
      zone.origin.y + zone.height - 1 + this.metrics.zoneLabelGapTiles;
    if (topSeatY === null) {
      return boundary;
    }
    return Math.max(
      boundary,
      this.seatedBubbleTopTiles(topSeatY) + this.metrics.zoneLabelGapTiles
    );
  }

  /**
   * 좌석에 앉은 사람의 상시 말풍선 위끝이 격자에서 몇 칸 높이에 오는가.
   *
   * 최악(두 줄)을 기준으로 잰다. 지금 한 줄인 사람에 맞춰 문패를 내리면, 옆자리가 긴 문구를
   * 받아 두 줄이 되는 순간 문패가 다시 그 위를 덮는다.
   */
  seatedBubbleTopTiles(seatY) {
    const boxTiles =
      (this.bubbleFontSize() * this.metrics.labelBoxRatio * this.metrics.bubbleMaxLines) /
      this.tileSize;
    const clearance =
      (this.nameplateFontSize() +
        this.tileSize * this.metrics.nameplateGapTiles +
        this.metrics.nameplateClearancePadding) /
      this.tileSize;
    return (
      seatY -
      this.metrics.seatedSpriteDrop +
      this.metrics.seatedSpriteTiles +
      clearance +
      boxTiles
    );
  }

  /**
   * 상단 밴드(회의실·대표실·탕비실) 이름표.
   *
   * 밴드 안이라 좌석을 피할 필요가 없다고 보면 안 된다 — **아래 방의 말풍선이 밴드까지
   * 올라온다.** 작은 창에서는 두 줄로 접혀 더 높아진다.
   */
  drawCommonAreaLabels(occupied) {
    const context = this.context;
    const fontSize = Math.max(
      this.metrics.zoneLabelMinFontSize,
      this.tileSize * 0.32
    );
    for (const area of this.plan.commonAreas) {
      const text = `${area.icon} ${area.label}`;
      context.save();
      context.font = this.labelFont(fontSize);
      const width = context.measureText(text).width + 10;
      context.restore();

      // 왼쪽 끝을 선호하되, 부서 문패 판과 겹치면 방 안의 가장 가까운 안전 위치로 옮긴다.
      // 기준점은 글자가 아니라 **판의 왼쪽 끝**이라 판이 글자 밖으로 넓어지는 몫을 뺀다.
      const plateBleed = 5;
      const preferred =
        this.originX + (area.originX + 0.5) * this.tileSize - plateBleed;
      const trailing =
        this.originX + (area.originX + area.width - 0.5) * this.tileSize + plateBleed;
      const leading = nonOverlappingLeadingX({
        preferred,
        min: preferred,
        max: trailing - width,
        width,
        occupied,
        separation: this.metrics.labelSeparationMinPixels,
      });
      occupied.push([leading, leading + width]);

      const below = this.topSeatYBelow(area);
      let bottomTiles = area.labelY + this.metrics.commonAreaLabelGapTiles;
      if (below !== null) {
        bottomTiles = Math.max(
          bottomTiles,
          this.seatedBubbleTopTiles(below) + this.metrics.zoneLabelGapTiles
        );
      }
      // 색은 부서색을 쓰지 않고 중성 회색이다. 사람이 상주하지 않는 방이라 부서 문패보다
      // 뒤로 물러나야 관제 신호(사람·상태 링)가 먼저 읽힌다.
      this.drawPlateLabel(text, {
        centerX: leading + width / 2,
        bottomY: this.originY + bottomTiles * this.tileSize,
        fontSize,
        alpha: 0.62,
        textColor: [0.72, 0.72, 0.72],
        borderColor: [0.45, 0.45, 0.45],
        padding: 10,
      });
    }
  }

  /** 이 밴드 아래에서 x 가 겹치는 부서 구역의 첫 좌석 행. 없으면 null. */
  topSeatYBelow(area) {
    const overlapping = this.plan.zones.filter(
      (zone) =>
        zone.origin.x < area.originX + area.width &&
        area.originX < zone.origin.x + zone.width
    );
    const seatRows = overlapping
      .map((zone) => this.topSeatY(zone))
      .filter((value) => value !== null);
    return seatRows.length > 0 ? Math.max(...seatRows) : null;
  }

  drawPresidentLabel() {
    const tile = this.plan.presidentTile;
    if (!tile) {
      return;
    }
    const image = sprite("char-down");
    const point = this.floorPoint(tile);
    const height = image
      ? image.naturalHeight * this.characterScale
      : this.tileSize * 1.35;
    this.drawPlateLabel("👑 나 (대표)", {
      centerX: point.x,
      bottomY: point.y + height + this.tileSize * this.metrics.nameplateGapTiles,
      fontSize: this.nameplateFontSize(),
      alpha: 0.72,
    });
  }
}

// MARK: - 순수 계산

/** 오늘 끝낸 일 건수를 서류 장수로 바꾼다. 건수가 두 배로 늘 때마다 한 장 올라간다. */
export function paperCount(doneToday, maxCount) {
  if (!doneToday || doneToday <= 0) {
    return 0;
  }
  // 2로 계속 나누며 세면 정확히 "두 배마다 한 장" 이 된다. log2 는 경계값(4·8·16)에서
  // 부동소수점 오차가 한 장을 깎을 수 있다.
  let papers = 0;
  let remaining = doneToday;
  while (remaining > 0 && papers < maxCount) {
    papers += 1;
    remaining = Math.floor(remaining / 2);
  }
  return papers;
}

/**
 * 다른 라벨의 x 구간을 피하면서, 허용 구간 안에서 선호 위치와 가장 가까운 왼쪽 끝.
 *
 * 상단 밴드와 부서 구역은 열 수에 따라 서로 다른 격자로 나뉜다. "밴드 왼쪽, 부서 가운데"
 * 같은 고정 정렬은 3열에서만 우연히 떨어지고 2열에서는 다시 만난다.
 */
export function nonOverlappingLeadingX({
  preferred,
  min,
  max,
  width,
  occupied,
  separation,
}) {
  const upper = Math.max(min, max);
  const wanted = Math.min(Math.max(preferred, min), upper);
  const candidates = [wanted, min, upper];
  for (const [start, end] of occupied) {
    candidates.push(start - separation - width, end + separation);
  }
  const feasible = candidates.filter(
    (leading) =>
      leading >= min &&
      leading <= upper &&
      occupied.every(
        ([start, end]) =>
          leading + width + separation <= start || end + separation <= leading
      )
  );
  if (feasible.length === 0) {
    return wanted;
  }
  return feasible.reduce((best, leading) =>
    Math.abs(leading - wanted) < Math.abs(best - wanted) ? leading : best
  );
}

/** 폭에 맞춰 줄을 접는다. 줄 수를 넘기면 마지막 줄을 말줄임한다. */
function wrapText(context, text, maxWidth, maxLines) {
  if (!Number.isFinite(maxWidth) || maxLines <= 1) {
    return [text];
  }
  const lines = [];
  let current = "";
  for (const character of [...text]) {
    const candidate = current + character;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
      if (lines.length === maxLines) {
        break;
      }
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  }
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (context.measureText(last).width > maxWidth) {
      lines[maxLines - 1] = `${last.slice(0, -1)}…`;
    }
  }
  return lines.length > 0 ? lines : [text];
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  context.rect(x, y, width, height);
}
