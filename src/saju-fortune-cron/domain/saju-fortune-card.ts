// 운세 응답 끝의 카드 두 줄(받는 사람에게는 안 보임)을 떼어 그림 생성 입력으로 쓴다.
export const CARD_TITLE_LABEL = 'CARD_TITLE:';
export const CARD_SCENE_LABEL = 'CARD_SCENE:';

// 그림에 실제로 찍히는 글자라 영문 대문자만 받는다 — 한글은 그림 모델이 깨뜨린다.
const CARD_TITLE_PATTERN = /^[A-Z][A-Z' -]{2,39}$/;
const MAXIMUM_SCENE_LENGTH = 400;

export interface FortuneCard {
  title: string;
  scene: string;
}

export interface ParsedFortune {
  body: string;
  // 두 줄 중 하나라도 없거나 형식이 틀리면 없다 — 그림 없이 글만 보낸다.
  card?: FortuneCard;
}

const valueAfter = ({
  line,
  label,
}: {
  line: string;
  label: string;
}): string => {
  const valueStart = line.indexOf(label) + label.length;
  const value = line.slice(valueStart).trim();
  return value;
};

// 줄이 없으면(모델이 라벨을 빼먹음) 빈 문자열 — 뒤의 형식 검사가 카드 없음으로 처리한다.
const valueOfLine = ({
  line,
  label,
}: {
  line: string | undefined;
  label: string;
}): string => {
  if (line === undefined) {
    return '';
  }
  const value = valueAfter({ line, label });
  return value;
};

export const parseFortuneResponse = (text: string): ParsedFortune => {
  const lines = text.split('\n');
  const titleLine = lines.find((line) => line.includes(CARD_TITLE_LABEL));
  const sceneLine = lines.find((line) => line.includes(CARD_SCENE_LABEL));
  // 카드 줄은 형식이 틀려도 본문에서 뺀다 — 받는 사람에게 "CARD_TITLE:" 이 보이면 안 된다.
  const body = lines
    .filter(
      (line) =>
        !line.includes(CARD_TITLE_LABEL) && !line.includes(CARD_SCENE_LABEL),
    )
    .join('\n')
    .trim();

  const title = valueOfLine({ line: titleLine, label: CARD_TITLE_LABEL });
  const scene = valueOfLine({
    line: sceneLine,
    label: CARD_SCENE_LABEL,
  }).slice(0, MAXIMUM_SCENE_LENGTH);
  if (!CARD_TITLE_PATTERN.test(title) || scene.length === 0) {
    return { body };
  }
  return { body, card: { title, scene } };
};

// 그림 모델에 넘기는 지시. 스타일은 고정해 매일 같은 카드 덱처럼 보이게 하고, 장면만 바꾼다.
export const buildFortuneCardImagePrompt = ({
  title,
  scene,
}: FortuneCard): string =>
  [
    'Generate exactly one image with your image generation tool. Do not run any shell commands.',
    'A mystical tarot card, portrait 2:3, ornate gold border with star motifs, rich painterly illustration, deep navy and gold palette.',
    `Scene: ${scene}`,
    `The only text on the card is the title "${title}" in a gold banner at the bottom. No other letters, numbers or faces.`,
    'After the image is generated, reply with the single word DONE.',
  ].join('\n');
