// 직원 외형표 — 맥 2D 가 쓰는 cozy 원화(`cozy/characters/agent-<번호>.png`)를 3D 부품으로 옮겨 적은 것.
//
// 누가 어느 원화를 쓰는지는 맥 앱이 정해 평면도의 `agentLooks[*].cozyAsset` 로 보낸다
// (`cozyAgentAppearance` 의 `assetIndex`). 여기는 번호 → 생김새만 안다. 원화를 새로 그리거나
// 바꾸면 이 표도 같이 고친다 — 번호가 어긋나면 2D 와 3D 가 다른 사람이 된다.
//
// 색은 원화에서 눈으로 뽑은 sRGB(0~1). 부품 이름:
//   hair   short · curly · bob · long · ponytail · braids · braid · spiky
//   outfit cardigan · sweater · vest · hoodie · jacket · work
//   bottom pants · skirt
//   extras glasses · clip · headband · headset · neckphones · lanyard · bow

const HAIR = {
  brown: [0.42, 0.25, 0.16],
  darkBrown: [0.27, 0.17, 0.12],
  auburn: [0.52, 0.23, 0.16],
  lightBrown: [0.58, 0.38, 0.22],
  black: [0.15, 0.13, 0.14],
  navyBlack: [0.14, 0.15, 0.26],
  gray: [0.66, 0.65, 0.64],
  silver: [0.76, 0.76, 0.77],
  steel: [0.4, 0.4, 0.43],
};
const INNER = { white: [0.97, 0.96, 0.93], lightBlue: [0.74, 0.83, 0.95], butter: [0.98, 0.9, 0.62] };
const SHOES = {
  loafer: [0.36, 0.21, 0.14],
  white: [0.95, 0.94, 0.91],
  beige: [0.84, 0.77, 0.65],
  dark: [0.26, 0.23, 0.23],
  navy: [0.2, 0.25, 0.4],
  boot: [0.2, 0.18, 0.17],
};

const longOrange = {
  hair: "long",
  hairColor: HAIR.brown,
  outfit: "cardigan",
  top: [0.96, 0.64, 0.3],
  inner: INNER.white,
  bottom: "pants",
  legs: [0.82, 0.72, 0.6],
  shoes: SHOES.loafer,
  extras: { clip: [0.95, 0.47, 0.42] },
  smile: "open",
};
const ponytailGreen = {
  hair: "ponytail",
  hairColor: HAIR.darkBrown,
  outfit: "cardigan",
  top: [0.53, 0.63, 0.46],
  inner: INNER.white,
  bottom: "pants",
  legs: [0.25, 0.27, 0.38],
  shoes: SHOES.loafer,
  extras: { bow: [0.45, 0.62, 0.52] },
  smile: "soft",
};

/** 번호 → 생김새. 인덱스가 곧 원화 번호다(0~19). */
export const COZY_LOOKS = [
  longOrange,
  ponytailGreen,
  { ...ponytailGreen, top: [0.71, 0.59, 0.88], extras: { bow: [0.7, 0.55, 0.88] } },
  {
    hair: "bob",
    hairColor: HAIR.lightBrown,
    outfit: "sweater",
    top: [0.97, 0.78, 0.26],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.42, 0.27, 0.18],
    shoes: SHOES.beige,
    extras: { clip: [0.95, 0.72, 0.2] },
    smile: "open",
  },
  longOrange,
  ponytailGreen,
  {
    hair: "bob",
    hairColor: HAIR.auburn,
    outfit: "cardigan",
    top: [0.2, 0.5, 0.52],
    inner: INNER.white,
    bottom: "skirt",
    legs: [0.86, 0.66, 0.26],
    shoes: SHOES.loafer,
    extras: { clip: [0.98, 0.8, 0.25] },
    smile: "open",
  },
  {
    hair: "curly",
    hairColor: HAIR.black,
    outfit: "hoodie",
    top: [0.88, 0.39, 0.29],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.45, 0.53, 0.4],
    shoes: SHOES.white,
    extras: { glasses: [0.2, 0.18, 0.18], lanyard: [0.25, 0.35, 0.6] },
    smile: "soft",
  },
  {
    hair: "ponytail",
    hairColor: HAIR.brown,
    outfit: "cardigan",
    top: [0.72, 0.6, 0.9],
    inner: INNER.butter,
    bottom: "pants",
    legs: [0.25, 0.27, 0.38],
    shoes: SHOES.loafer,
    extras: { bow: [0.7, 0.55, 0.88] },
    smile: "soft",
  },
  {
    hair: "short",
    hairColor: HAIR.lightBrown,
    outfit: "cardigan",
    top: [0.36, 0.58, 0.85],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.72, 0.34, 0.2],
    shoes: SHOES.dark,
    extras: {},
    smile: "soft",
  },
  {
    hair: "braids",
    hairColor: HAIR.navyBlack,
    outfit: "sweater",
    top: [0.85, 0.36, 0.49],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.86, 0.81, 0.71],
    shoes: SHOES.white,
    extras: { bow: [0.98, 0.78, 0.25] },
    smile: "soft",
  },
  {
    hair: "bob",
    hairColor: HAIR.gray,
    outfit: "vest",
    top: [0.23, 0.33, 0.25],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.42, 0.27, 0.18],
    shoes: SHOES.loafer,
    extras: { glasses: [0.25, 0.28, 0.26] },
    smile: "soft",
  },
  {
    hair: "short",
    hairColor: HAIR.brown,
    outfit: "vest",
    top: [0.86, 0.63, 0.23],
    inner: INNER.lightBlue,
    bottom: "pants",
    legs: [0.25, 0.46, 0.49],
    shoes: SHOES.loafer,
    extras: { glasses: [0.27, 0.35, 0.28] },
    smile: "open",
  },
  {
    hair: "bob",
    hairColor: HAIR.auburn,
    outfit: "jacket",
    top: [0.33, 0.41, 0.59],
    inner: INNER.white,
    bottom: "skirt",
    legs: [0.71, 0.31, 0.28],
    shoes: SHOES.loafer,
    extras: { glasses: [0.2, 0.2, 0.22], headband: [0.2, 0.25, 0.45] },
    smile: "soft",
  },
  {
    hair: "curly",
    hairColor: HAIR.black,
    outfit: "cardigan",
    top: [0.92, 0.43, 0.26],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.21, 0.21, 0.25],
    shoes: SHOES.loafer,
    extras: { headset: [0.2, 0.42, 0.46] },
    smile: "soft",
  },
  {
    hair: "braid",
    hairColor: HAIR.auburn,
    outfit: "sweater",
    top: [0.61, 0.75, 0.57],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.42, 0.27, 0.18],
    shoes: SHOES.beige,
    extras: { bow: [0.7, 0.55, 0.88], clip: [0.98, 0.8, 0.25] },
    smile: "open",
  },
  {
    hair: "curly",
    hairColor: HAIR.brown,
    outfit: "vest",
    top: [0.93, 0.88, 0.78],
    inner: INNER.lightBlue,
    bottom: "pants",
    legs: [0.72, 0.34, 0.2],
    shoes: SHOES.loafer,
    extras: { glasses: [0.22, 0.2, 0.18], lanyard: [0.25, 0.35, 0.6] },
    smile: "open",
  },
  {
    hair: "curly",
    hairColor: HAIR.black,
    outfit: "hoodie",
    top: [0.9, 0.42, 0.3],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.46, 0.51, 0.36],
    shoes: SHOES.white,
    extras: { glasses: [0.2, 0.18, 0.18], neckphones: [0.2, 0.42, 0.46] },
    smile: "open",
  },
  {
    hair: "short",
    hairColor: HAIR.brown,
    outfit: "jacket",
    top: [0.17, 0.21, 0.35],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.23, 0.23, 0.27],
    shoes: SHOES.navy,
    extras: { lanyard: [0.55, 0.35, 0.2] },
    smile: "soft",
  },
  {
    hair: "short",
    hairColor: HAIR.silver,
    outfit: "cardigan",
    top: [0.53, 0.61, 0.46],
    inner: INNER.white,
    bottom: "pants",
    legs: [0.72, 0.34, 0.2],
    shoes: SHOES.loafer,
    extras: { lanyard: [0.4, 0.5, 0.7] },
    smile: "soft",
  },
];

/** 정비사(라우터) — 원화 번호 -1(`cozyMechanicAssetIndex`). */
export const MECHANIC_LOOK = {
  hair: "spiky",
  hairColor: HAIR.steel,
  outfit: "work",
  top: [0.9, 0.46, 0.12],
  inner: [0.2, 0.2, 0.22],
  bottom: "pants",
  legs: [0.2, 0.2, 0.23],
  shoes: SHOES.boot,
  extras: {},
  smile: "soft",
};

/** 대표 — 평면도에 몫이 없다. 짙은 재킷에 흰 셔츠. */
export const PRESIDENT_COZY_LOOK = {
  hair: "short",
  hairColor: HAIR.black,
  outfit: "jacket",
  top: [0.22, 0.24, 0.3],
  inner: INNER.white,
  bottom: "pants",
  legs: [0.26, 0.26, 0.3],
  shoes: SHOES.loafer,
  extras: {},
  smile: "soft",
};

/**
 * 옛 평면도(`cozyAsset` 없음)는 시트 이름만 준다 — 머리 모양이 가까운 원화로 대신한다.
 * 이때는 2D 와 같은 사람이 아니다. 평면도를 다시 뽑으면 맞는다.
 */
const SHEET_FALLBACK = { char: 9, charb: 1, charc: 12, chard: 7, chare: 6 };

/** 표에 없는 원화 번호. 한 번씩만 알린다(사람마다 매 장면 되풀이하지 않게). */
const reportedUnknown = new Set();

/**
 * 평면도의 외형 한 줄 → 생김새.
 *
 * 표 밖의 번호는 **접어서 쓰지 않는다.** 맥이 원화를 늘렸는데 이 표를 안 고치면, 접은 번호는 오류 없이
 * 다른 직원의 얼굴이 된다. 시트 대체로 그리고 콘솔에 번호를 남겨 표가 낡았음을 드러낸다.
 */
export function cozyLookFor(look) {
  if (look?.cozy) {
    return look.cozy;
  }
  const asset = look?.cozyAsset;
  if (asset === -1) {
    return MECHANIC_LOOK;
  }
  if (Number.isInteger(asset) && asset >= 0 && asset < COZY_LOOKS.length) {
    return COZY_LOOKS[asset];
  }
  if (asset !== undefined && !reportedUnknown.has(asset)) {
    reportedUnknown.add(asset);
    console.warn(`cozy-looks.js 에 없는 원화 번호 ${asset} — 표를 원화와 맞춰야 한다(시트 대체로 그린다)`);
  }
  return COZY_LOOKS[SHEET_FALLBACK[look?.sheet] ?? 9];
}
