import { ArtJobKeywordSet, findMatchedTerms } from './art-job-keyword';

// 배경 직무는 범위 밖이지만, "캐릭터/배경 원화" 처럼 캐릭터를 같이 맡는 공고는 받는다.
const BACKGROUND_TERM = /배경/;
const CHARACTER_TERM = /캐릭터/;

export const isTargetArtRole = (
  title: string,
  keywords: Pick<ArtJobKeywordSet, 'target' | 'excluded'>,
): boolean => {
  if (
    findMatchedTerms(keywords.target, title).length === 0 ||
    findMatchedTerms(keywords.excluded, title).length > 0
  ) {
    return false;
  }
  if (BACKGROUND_TERM.test(title)) {
    return CHARACTER_TERM.test(title);
  }
  return true;
};
