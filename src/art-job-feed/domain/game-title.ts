// '구인'·'○○게임즈'(회사명 음역)·'로켓점프4기'(채용 프로그램 기수)도 실측(2026-10-15)에서 게임명으로 잘못 잡혔다.
const NON_GAME_TERMS =
  /프로젝트|project|신규|외주|프리랜서|재택|본부|소속|채용|모집|구인|인턴|스튜디오|studio|games|게임즈|개발실|live-ops|\bai\b|\bteam\b|\bip\b|(^|\W)팀(\W|$)|\d+기$/i;
// 회사 대표게임은 이 수까지만 찾아본다 — 이름마다 플레이스토어 검색을 한 번씩 한다.
const MAX_REPRESENTATIVE_GAMES = 3;
// 대표게임 칸에서는 'Project S'·'프로젝트A' 같은 짧은 코드명만 뺀다. 공고 태그용 NON_GAME_TERMS 를 쓰면
// 'Project Zomboid' 같은 실제 출시작까지 지워진다.
const CODENAME = /^(project|프로젝트)\s*[a-z0-9가-힣]{1,3}$/i;
// 'Ⅰ'~'Ⅻ'(U+2160~216B)·'ⅰ'~'ⅻ'(U+2170~217B) — 지우면 '리니지Ⅱ' 가 '리니지' 로 줄어 다른 게임과 섞인다.
const ROMAN_NUMERAL = /[\u2160-\u216B\u2170-\u217B]/g;

export const normalizeTitleKey = (text: string): string => {
  return text
    .replace(ROMAN_NUMERAL, (numeral) => {
      return String(((numeral.charCodeAt(0) - 0x2160) % 16) + 1);
    })
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, '');
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

// 게임잡 회사 정보의 「대표게임」 칸('리니지, 리니지Ⅱ, AION 등', '스타세이비어 (https://…)') → 게임명 목록.
// 'Project S' 같은 미공개 코드명은 이미지를 찾을 수 없어 뺀다.
export const splitRepresentativeGames = (text: string): string[] => {
  return text
    .replace(/\(\s*https?:\/\/[^)]*\)/g, '')
    .split(/[,，/]|\s등$/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !CODENAME.test(name))
    .slice(0, MAX_REPRESENTATIVE_GAMES);
};
