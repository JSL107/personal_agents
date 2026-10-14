const NON_GAME_TERMS =
  /프로젝트|project|신규|외주|프리랜서|재택|본부|소속|채용|모집|스튜디오|studio|games|개발실|live-ops|\bai\b|\bteam\b|\bip\b|(^|\W)팀(\W|$)/i;

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
  const companyCore = cleanCompanyName(company);
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

// '㈜스튜디오비사이드', '스마일게이트 (지점)' → 법인 표기와 괄호 꼬리를 뗀 이름.
export const cleanCompanyName = (company: string): string => {
  return company
    .replace(/㈜|\(주\)|주식회사/g, '')
    .replace(/[([].*$/, '')
    .trim();
};

// 이미지 검색어. 게임명만 검색하면 동명의 다른 게임이 걸려서 회사명을 함께 넣는다.
export const buildImageSearchQuery = (
  company: string,
  gameTitle: string | null,
): string => {
  return `${cleanCompanyName(company)} ${gameTitle ?? '게임'}`.trim();
};
