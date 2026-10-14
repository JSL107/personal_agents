// 받는 사람이 본문 번호 이모지(1️⃣~🔟)를 달면 그 공고를 제외한다. 본문은 회차당 한 통이라
// 리액션이 메시지 단위로만 붙으므로, 어느 공고인지는 이모지의 숫자로 가린다.
const ORDER_BY_REACTION: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  keycap_ten: 10,
};

export const digestOrderFromReaction = (reaction: string): number | null => {
  return ORDER_BY_REACTION[reaction] ?? null;
};

// 장부는 공고 번호(GI_No)로 중복을 막으므로 같은 번호는 원래 다시 안 나간다. 제외가 실제로
// 막는 것은 회사가 같은 공고를 새 번호로 다시 올린 경우 — 그래서 회사 + 제목으로 같은 공고를 판정한다.
export const exclusionKey = (company: string, title: string): string => {
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
  return `${tidy(company)}\n${tidy(title)}`;
};
