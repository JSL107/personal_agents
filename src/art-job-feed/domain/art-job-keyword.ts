export type ArtJobKeywordKind = 'TARGET' | 'EXCLUDED' | 'STYLE';

export interface ArtJobKeywordSet {
  target: string[];
  excluded: string[];
  style: string[];
}

export const ART_JOB_KEYWORD_SEED: ArtJobKeywordSet = {
  target: [
    '원화',
    '컨셉',
    '콘셉트',
    'concept',
    '일러스트',
    '아티스트',
    'artist',
    '그래픽',
    '디자이너',
    '캐주얼',
    '픽셀',
    '도트',
    '아트',
    '캐릭터',
  ],
  excluded: [
    '3D',
    '모델링',
    '모델러',
    '애니메이터',
    '애니메이션',
    'VFX',
    '이펙트',
    'UI',
    'GUI',
    'UX',
    '강사',
    '개발자',
    '프로그래머',
    '기획',
  ],
  style: ['북미풍', '캐주얼'],
};

export const normalizeKeywordTerm = (raw: string): string => {
  return raw.trim().replace(/\s+/g, ' ');
};

export const validateKeywordTerm = (raw: string): string | null => {
  if (/[\r\n]/.test(raw) || /<[^>]*>/.test(raw)) {
    return '키워드에는 줄바꿈이나 Slack 토큰을 넣을 수 없습니다.';
  }
  const term = normalizeKeywordTerm(raw);
  if (term.length === 0 || term.length > 20) {
    return '키워드는 1~20자여야 합니다.';
  }
  return null;
};

const escapeRegularExpression = (term: string): string => {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

export const findMatchedTerms = (terms: string[], text: string): string[] => {
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const key = term.toLocaleLowerCase();
    if (seen.has(key) || term.length === 0) {
      continue;
    }
    const escaped = escapeRegularExpression(term);
    const expression = [...term].every(
      (character) => character.charCodeAt(0) < 128,
    )
      ? new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'i')
      : new RegExp(escaped, 'i');
    if (expression.test(text)) {
      seen.add(key);
      matched.push(term);
    }
  }
  return matched;
};
