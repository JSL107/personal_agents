// 장부는 공고 번호(GI_No)로 중복을 막으므로 같은 번호는 원래 다시 안 나간다. 제외가 실제로
// 막는 것은 회사가 같은 공고를 새 번호로 다시 올린 경우 — 그래서 회사 + 제목으로 같은 공고를 판정한다.
export const exclusionKey = (company: string, title: string): string => {
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
  return `${tidy(company)}\n${tidy(title)}`;
};

// 본문 버튼 문구. Slack 버튼(art-job-feed.formatter.ts)과 대화 답변의 기능 안내(router passive-capability.ts)가
// 함께 쓴다 — 안내 문구를 따로 적어 두었더니 #804 에서 조작법이 바뀐 순간 안내가 틀어졌다.
// 조작법을 바꾸면 이 상수를 고치거나 지우게 되고, 그러면 안내 쪽도 같이 바뀌거나 빌드가 깨진다.
export const ART_JOB_EXCLUDE_LABEL = '관심 없음';
export const ART_JOB_RESTORE_LABEL = '제외됨 · 되돌리기';
// 「관심 있음」은 마감일이 있는 공고에만 달리고, 누르면 마감 전날 DM 으로 알린다(#808).
export const ART_JOB_INTEREST_LABEL = '관심 있음';
export const ART_JOB_UNINTEREST_LABEL = '관심 공고 · 되돌리기';
