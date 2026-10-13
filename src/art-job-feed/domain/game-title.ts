const NON_GAME_TERMS =
  /프로젝트|project|신규|외주|프리랜서|재택|본부|소속|채용|모집|스튜디오|studio|games|개발실|live-ops|\bai\b|\bteam\b|(^|\W)팀(\W|$)/i;

export const normalizeTitleKey = (text: string): string => {
  return text.toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
};

export const extractGameTitle = (
  title: string,
  company: string,
): string | null => {
  const candidate = /^\s*\[([^\]]+)\]/.exec(title)?.[1]?.trim();
  if (!candidate || NON_GAME_TERMS.test(candidate)) {
    return null;
  }
  const companyCore = company
    .replace(/㈜|\(주\)|주식회사/g, '')
    .replace(/[([].*$/, '')
    .trim();
  const candidateKey = normalizeTitleKey(candidate);
  const companyKey = normalizeTitleKey(companyCore);
  if (
    companyKey &&
    (candidateKey.includes(companyKey) || companyKey.includes(candidateKey))
  ) {
    return null;
  }
  return candidate;
};
