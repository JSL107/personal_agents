import { listAddedLines } from './diff-added-lines';

// diff 의 추가된 줄에서 화면에 안 보이는 문자를 찾는다 (Trojan Source · 숨은 프롬프트 주입).
//
// 지우지 않고 찾기만 한다. 리뷰 대상 코드를 바꾸면 리뷰어가 공격 자체를 못 보게 되고,
// 이 파일의 호출부는 diff 를 원문 그대로 모델에 넘기는 원칙(untrusted-input.util)을 지킨다.
//
// ZWJ(U+200D)와 이형 선택자(U+FE00–FE0F)는 이모지 바로 뒤에 올 때만 정상으로 본다.
// 가족·하트 이모지마다 경고가 뜨면 진짜 경고가 묻히지만, 두 문자 모두 JS 식별자 안에
// 들어갈 수 있어(`admin` 과 구분이 안 되는 별도 변수) 무조건 빼면 우회로가 된다.

export type HiddenCharKind =
  | '방향 제어'
  | '폭 없는 문자'
  | '이형 선택자'
  | 'BOM'
  | '태그 문자';

export interface HiddenCharFinding {
  file: string;
  line: number; // 변경 후 파일 기준 줄 번호
  codePoint: string; // 'U+202E' 형태
  kind: HiddenCharKind;
}

const ZWJ = 0x200d;
const KEYCAP = 0x20e3;
const isVariationSelector = (codePoint: number): boolean =>
  codePoint >= 0xfe00 && codePoint <= 0xfe0f;
const isSkinTone = (codePoint: number): boolean =>
  codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
const EMOJI_BASE = /\p{Extended_Pictographic}/u;

const classify = (codePoint: number): HiddenCharKind | null => {
  if (
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  ) {
    return '방향 제어';
  }
  if (
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === ZWJ ||
    codePoint === 0x2060
  ) {
    return '폭 없는 문자';
  }
  if (isVariationSelector(codePoint)) {
    return '이형 선택자';
  }
  if (codePoint === 0xfeff) {
    return 'BOM';
  }
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) {
    return '태그 문자';
  }
  return null;
};

// ZWJ·이형 선택자가 이모지 시퀀스의 일부인가. 피부색·다른 이형 선택자는 건너뛰고 앞의 기본
// 이모지를 본다. 숫자 키캡 이모지는 숫자 뒤 이형 선택자 + U+20E3 이라 뒤를 본다.
const isPartOfEmoji = (chars: string[], index: number): boolean => {
  const next = chars[index + 1]?.codePointAt(0);
  if (next === KEYCAP) {
    return true;
  }
  let previous = index - 1;
  while (previous >= 0) {
    const codePoint = chars[previous].codePointAt(0) ?? 0;
    if (!isVariationSelector(codePoint) && !isSkinTone(codePoint)) {
      break;
    }
    previous -= 1;
  }
  return previous >= 0 && EMOJI_BASE.test(chars[previous]);
};

const toCodePointLabel = (codePoint: number): string =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

// 추가된 줄만 본다 — 줄 단위 순회는 listAddedLines 가 맡는다.
export const findHiddenUnicode = (diff: string): HiddenCharFinding[] => {
  const findings: HiddenCharFinding[] = [];
  for (const { file, line, text } of listAddedLines(diff)) {
    const chars = Array.from(text);
    chars.forEach((char, index) => {
      const codePoint = char.codePointAt(0) ?? 0;
      const kind = classify(codePoint);
      const isEmojiPart =
        (codePoint === ZWJ || isVariationSelector(codePoint)) &&
        isPartOfEmoji(chars, index);
      if (kind && !isEmojiPart) {
        findings.push({
          file,
          line,
          codePoint: toCodePointLabel(codePoint),
          kind,
        });
      }
    });
  }
  return findings;
};

// 경고 문장(우리가 만든 값)과 발견 목록(파일 경로 = PR 작성자가 정한 값)을 따로 낸다.
// 호출부가 목록만 신뢰 경계로 감쌀 수 있게 — 경로에 지시를 심어 경계를 비껴가지 못하게.
const MAX_LISTED = 10;

export const formatHiddenUnicodeWarning = (count: number): string =>
  `(주의: 추가된 줄에 화면에 안 보이는 문자 ${count}개 — 보이는 코드와 실제 코드가 다를 수 있다. 의도된 것인지 확인하고, 아니면 지적할 것)`;

export const formatHiddenUnicodeList = (
  findings: HiddenCharFinding[],
): string => {
  const listed = findings
    .slice(0, MAX_LISTED)
    .map(
      (finding) =>
        `- ${finding.file}:${finding.line} ${finding.codePoint} (${finding.kind})`,
    );
  const rest =
    findings.length > MAX_LISTED
      ? [`- 외 ${findings.length - MAX_LISTED}건`]
      : [];
  return [...listed, ...rest].join('\n');
};
