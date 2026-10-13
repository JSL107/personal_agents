// 받는 사람이 고른 범위: 원화·컨셉에 더해 캐주얼 / 캐릭터 컨셉 / 아티스트 / 2D 게임 그래픽 / 디자이너
// (2026-10-13). 일러스트·픽셀·아트까지 조금 넓게 받는다.
const TARGET_TERMS =
  /원화|컨셉|콘셉트|concept|일러스트|아티스트|artist|그래픽|디자이너|캐주얼|픽셀|도트|아트/i;

// 2D 아트가 아닌 직무. 캐릭터 공고라도 예외 없이 적용한다 — "3D 캐릭터 원화" 가 들어오면 안 된다.
const EXCLUDED_TERMS =
  /3D|모델링|모델러|애니메이터|애니메이션|VFX|이펙트|\bG?UI\b|\bUX\b|강사|개발자|프로그래머|기획/i;

// 배경 직무는 범위 밖이지만, "캐릭터/배경 원화" 처럼 캐릭터를 같이 맡는 공고는 받는다.
const BACKGROUND_TERM = /배경/;
const CHARACTER_TERM = /캐릭터/;

export const isTargetArtRole = (title: string): boolean => {
  if (!TARGET_TERMS.test(title) || EXCLUDED_TERMS.test(title)) {
    return false;
  }
  if (BACKGROUND_TERM.test(title)) {
    return CHARACTER_TERM.test(title);
  }
  return true;
};
