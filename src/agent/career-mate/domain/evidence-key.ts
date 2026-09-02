import { ProfileAccomplishment } from './career-mate.type';
import { toPrNumber } from './reconcile-accomplishment-evidence';

// 성과를 가리키는 키. 프로필을 다시 쓰는 경로들이 "같은 PR 의 성과" 를 알아보는 유일한 수단이라
// 한 곳에서만 만든다 — merge-accomplishment(편입) · preserve-impact-context(맥락 보존) ·
// humanize-career-profile.adapter(증분 윤문) 가 같은 키를 본다.
//
// 성과 식별은 도메인 규칙이므로 domain 에 둔다. application 에 두면 이 키를 쓰는 쪽이 안쪽에서
// 바깥을 import 하게 되어 계층 의존 방향(CODE_RULES §1-7)이 뒤집힌다.
export const evidenceKey = (item: ProfileAccomplishment): string => {
  const first = item.evidence[0];
  // 보정 전 `pr: "#984"` 가 남은 항목과 보정된 새 항목이 다른 키로 갈리면 dedup 이 빗나가
  // 같은 PR 성과가 둘 남는다.
  return first ? `${first.repo}#${toPrNumber(first.pr)}` : '';
};
