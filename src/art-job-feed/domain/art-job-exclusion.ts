// 장부는 공고 번호(GI_No)로 중복을 막으므로 같은 번호는 원래 다시 안 나간다. 제외가 실제로
// 막는 것은 회사가 같은 공고를 새 번호로 다시 올린 경우 — 그래서 회사 + 제목으로 같은 공고를 판정한다.
export const exclusionKey = (company: string, title: string): string => {
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
  return `${tidy(company)}\n${tidy(title)}`;
};
