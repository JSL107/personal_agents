import {
  CareerProfileData,
  ProfileAccomplishment,
} from '../domain/career-mate.type';

const evidenceKey = (item: ProfileAccomplishment): string => {
  const first = item.evidence[0];
  return first ? `${first.repo}#${first.pr}` : '';
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
