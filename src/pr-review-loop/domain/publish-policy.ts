import {
  FindingSeverity,
  ReviewFinding,
} from '../../agent/code-reviewer/domain/code-reviewer.type';

// 게시 우선순위 — 상한에 걸릴 때 무엇을 살릴지 결정한다.
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  MUST_FIX: 0,
  MISSING_TEST: 1,
  NICE_TO_HAVE: 2,
};

export interface PublishPlan {
  toPost: ReviewFinding[];
  dropped: ReviewFinding[];
}

export interface PlanPublicationInput {
  findings: ReviewFinding[];
  max: number;
}

// 게시 허용 레포 판정. 미설정이면 거부 — 게시는 외부에 보이는 행위라 명시적 옵트인만 인정한다.
// (issue 자동 라벨링의 allowlist 는 "미설정 = 전체 허용"이지만, 코멘트 게시는 반대로 잠근다.)
export const isRepoAllowed = (
  repo: string,
  allowlistRaw: string | undefined,
): boolean => {
  if (allowlistRaw === undefined || allowlistRaw.trim().length === 0) {
    return false;
  }
  const allowed = allowlistRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return allowed.includes(repo);
};

// 심각도 우선 정렬 후 상한으로 자른다. 같은 심각도 안에서는 모델이 낸 순서를 지킨다.
export const planPublication = ({
  findings,
  max,
}: PlanPublicationInput): PublishPlan => {
  const sorted = findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => {
      const bySeverity =
        SEVERITY_ORDER[left.finding.severity] -
        SEVERITY_ORDER[right.finding.severity];
      if (bySeverity !== 0) {
        return bySeverity;
      }
      return left.index - right.index;
    })
    .map((item) => item.finding);

  return { toPost: sorted.slice(0, max), dropped: sorted.slice(max) };
};
