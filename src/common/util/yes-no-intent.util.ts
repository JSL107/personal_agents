// 사용자 자연어 입력을 PreviewGate 의 "응 / 아니" 액션으로 매핑하는 keyword detector.
// LLM 없이 규칙 기반 — 짧은 메시지 (≤15자, normalize 후) 에서 정확한 키워드만 매칭. 긴 메시지는
// 새 의도 (예: "응 그리고 추가로 PR 리뷰") 일 수 있으므로 ambiguous 처리 (null 반환) → 일반 dispatch.
// Slack 자연어 핸들러와 콘솔 리모컨이 공유한다 (구 위치: slack/handler/yes-no-detector.ts).

export type YesNoIntent = 'yes' | 'no' | null;

const YES_KEYWORDS = new Set([
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
  'no',
  'n',
  'nope',
  'nah',
  'cancel',
  'stop',
  'abort',
  'reject',
]);
const MAX_NORMALIZED_LENGTH = 15;

const normalize = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/g, '')
    .trim();

export const detectYesNoIntent = (text: string): YesNoIntent => {
  const normalized = normalize(text);
  if (normalized.length === 0 || normalized.length > MAX_NORMALIZED_LENGTH) {
    return null;
  }
  if (YES_KEYWORDS.has(normalized)) {
    return 'yes';
  }
  if (NO_KEYWORDS.has(normalized)) {
    return 'no';
  }
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length >= 2 && tokens.length <= 4) {
    if (tokens.every((token) => YES_KEYWORDS.has(token))) {
      return 'yes';
    }
    if (tokens.every((token) => NO_KEYWORDS.has(token))) {
      return 'no';
    }
  }
  return null;
};
