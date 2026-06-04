// 사용자 자연어 입력을 PreviewGate 의 "응 / 아니" 액션으로 매핑하는 keyword detector.
// LLM 없이 규칙 기반 — 짧은 메시지 (≤15자, normalize 후) 에서 정확한 키워드만 매칭. 긴 메시지는
// 새 의도 (예: "응 그리고 추가로 PR 리뷰") 일 수 있으므로 ambiguous 처리 (null 반환) → 일반 dispatch.

export type YesNoIntent = 'yes' | 'no' | null;

const YES_KEYWORDS = new Set([
  // 한국어
  '응',
  '예',
  '네',
  '좋아',
  '좋아요',
  '그래',
  '그래요',
  'ㄱㄱ',
  '가자',
  '진행',
  '해줘',
  '해주세요',
  '맞아',
  '맞아요',
  'ㅇㅇ',
  // 영어 / 약어
  'ok',
  'okay',
  'yes',
  'y',
  'yeah',
  'yep',
  'sure',
  'go',
  'apply',
  'confirm',
]);

const NO_KEYWORDS = new Set([
  // 한국어
  '아니',
  '아니요',
  '싫어',
  '싫어요',
  '안돼',
  '안 돼',
  '안할래',
  '안 할래',
  '취소',
  '나중에',
  '됐어',
  '됐어요',
  'ㄴㄴ',
  'ㅋㄴ',
  // 영어 / 약어
  'no',
  'n',
  'nope',
  'nah',
  'cancel',
  'stop',
  'abort',
  'reject',
]);

// 너무 긴 메시지는 단순 Y/N 응답이 아닐 가능성 큼 — 규칙 적용 cutoff. (한국어 단답형 평균 8자.)
const MAX_NORMALIZED_LENGTH = 15;

// 입력 정규화 — 마침표 / 느낌표 / 물음표 / 양쪽 공백 제거 후 소문자.
const normalize = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/g, '')
    .trim();

// 정확 매칭 + 일부 prefix 매칭 ("yes!" "아니!!" 등 trailing punctuation 은 normalize 단계에서 처리).
// "응 ㄱㄱ" 같은 공백 포함도 정확 매칭으로 처리하려면 token 분해 후 모든 토큰이 같은 set 인지 확인.
export const detectYesNoIntent = (text: string): YesNoIntent => {
  const normalized = normalize(text);
  if (normalized.length === 0 || normalized.length > MAX_NORMALIZED_LENGTH) {
    return null;
  }
  // 단일 키워드 정확 매칭이 가장 명확.
  if (YES_KEYWORDS.has(normalized)) {
    return 'yes';
  }
  if (NO_KEYWORDS.has(normalized)) {
    return 'no';
  }
  // 다중 토큰 — 모든 토큰이 같은 set 에 속해야 매칭 ("응 ㄱㄱ" 같은 강조 반복 허용).
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length >= 2 && tokens.length <= 4) {
    if (tokens.every((t) => YES_KEYWORDS.has(t))) {
      return 'yes';
    }
    if (tokens.every((t) => NO_KEYWORDS.has(t))) {
      return 'no';
    }
  }
  return null;
};
