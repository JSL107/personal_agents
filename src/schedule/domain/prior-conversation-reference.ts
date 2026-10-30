// 조사만 허용해 "아까운" 같은 일반 낱말을 대화 참조로 오인하지 않는다.
const REFERENCE =
  /(?:^|[^가-힣])(원인|그거|그것|방금|위\s*내용|분석한|아까)(?=$|[^가-힣]|(?:과|와|을|를|이|가|은|는|에|에서|으로|로|도|만|의|랑|하고)(?=$|[^가-힣]))/;

export const refersToPriorConversation = (text: string): boolean =>
  REFERENCE.test(text);
