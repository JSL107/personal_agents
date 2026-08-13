// 갭 분석 후 "2" / "2번" / "2번으로 써줘" 처럼 주제 번호를 고른 응답을 1-based 인덱스로 파싱.
// 짧은 선택성 발화만 인정 (긴 문장은 일반 대화일 가능성 → null 로 fall through).
const MAX_LENGTH = 20;

export const parseTopicSelection = (
  text: string,
  topicCount: number,
): number | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) {
    return null;
  }
  const match = trimmed.match(/^(\d+)\s*(?:번)?/);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 1 || index > topicCount) {
    return null;
  }
  return index;
};
