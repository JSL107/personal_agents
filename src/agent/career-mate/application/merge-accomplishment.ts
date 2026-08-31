import {
  CareerProfileData,
  ProfileAccomplishment,
} from '../domain/career-mate.type';
import { toPrNumber } from '../domain/reconcile-accomplishment-evidence';

// 성과를 가리키는 키. 프로필을 다시 쓰는 경로들이 "같은 PR 의 성과" 를 알아보는 유일한 수단이라
// 한 곳에서만 만든다(preserve-impact-context.ts 도 이 키를 쓴다).
export const evidenceKey = (item: ProfileAccomplishment): string => {
  const first = item.evidence[0];
  // 보정 전 `pr: "#984"` 가 남은 항목과 보정된 새 항목이 다른 키로 갈리면 dedup 이 빗나가
  // 같은 PR 성과가 둘 남는다.
  return first ? `${first.repo}#${toPrNumber(first.pr)}` : '';
};

// 단일 PR 회고 accomplishment 를 최신 프로필에 편입한다 (순수 함수).
// - 프로필이 없으면 이 PR 하나로 최소 프로필을 만든다.
// - 있으면 같은 PR(evidence repo#pr)을 교체 후 맨 앞에 붙여 dedup append 한다.
export const mergeAccomplishment = ({
  latest,
  accomplishment,
  githubLogin,
  todayIsoDate,
}: {
  latest: CareerProfileData | null;
  accomplishment: ProfileAccomplishment;
  githubLogin: string;
  todayIsoDate: string;
}): CareerProfileData => {
  const key = evidenceKey(accomplishment);
  const mergedAt = accomplishment.evidence[0]?.mergedAt;

  if (!latest) {
    return {
      summary: accomplishment.bullet,
      skills: [],
      accomplishments: [accomplishment],
      meta: {
        githubLogin,
        windowStart: mergedAt ? mergedAt.slice(0, 10) : todayIsoDate,
        prCount: 1,
      },
    };
  }

  const kept = latest.accomplishments.filter(
    (item) => evidenceKey(item) !== key,
  );
  const accomplishments = [accomplishment, ...kept];
  const prCount = new Set(
    accomplishments.map((item) => evidenceKey(item)).filter(Boolean),
  ).size;

  return {
    ...latest,
    accomplishments,
    meta: { ...latest.meta, githubLogin, prCount },
  };
};
