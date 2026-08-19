import { ProfileAccomplishment } from './career-mate.type';

// 백필에 쓰는 권위 PR. 두 호출부의 PR 형태가 달라(`number` / `pr`) 최소 공통 형태만 받는다.
export type EvidencePullRequest =
  | {
      repo: string;
      number: number;
      mergedAt: string | null;
    }
  | {
      repo: string;
      pr: number;
      mergedAt: string | null;
    };

const toEvidenceKey = ({ repo, pr }: { repo: string; pr: number }): string =>
  `${repo.toLowerCase()}#${pr}`;

const getPullRequestNumber = (pullRequest: EvidencePullRequest): number => {
  if ('number' in pullRequest) {
    return pullRequest.number;
  }
  return pullRequest.pr;
};

// 모델이 `pr` 을 `"#984"` 같은 문자열로 흘린다 (실측: 프로필 1건의 근거 116개 중 24개).
// `pr: number` 선언과 어긋나지만 파서가 evidence 요소 내부까지 검증하지 않아 그대로 통과한다.
// 그대로 두면 세 곳이 조용히 깨진다 — 백필 키가 `repo##984` 로 어긋나 보정이 통째로 빠지고,
// `left.pr - right.pr` 정렬이 NaN 이 되어 slug 선택이 흔들리고, slug 에 `#` 가 섞여 사이트
// 조회 키와 어긋난다(그러면 같은 성과가 회차마다 새 항목으로 올라간다).
// 숫자로 읽을 수 없는 값은 손대지 않는다 — 추측한 번호로 남의 PR 을 가리키는 편이 더 나쁘다.
// 저장된 프로필에도 보정 전 값이 남아 있으므로 slug·dedup 키를 만드는 소비 지점에서도 쓴다.
export const toPrNumber = (pr: number): number => {
  if (Number.isInteger(pr)) {
    return pr;
  }
  const digits = String(pr).replace(/\D/g, '');
  return digits.length > 0 ? Number(digits) : pr;
};

// 모델 출력의 accomplishment evidence 를 권위 데이터에 맞춘다.
// - `pr` 은 항상 숫자 형태로 정규화한다.
// - `mergedAt` 은 입력 PR 목록에 있는 근거만 그 실제 값으로 덮어쓴다
//   (목록에 없는 근거는 모델 환각일 수 있어 판단을 보류하고 그대로 둔다).
export const reconcileAccomplishmentEvidence = ({
  accomplishments,
  pullRequests,
}: {
  accomplishments: ProfileAccomplishment[];
  pullRequests: EvidencePullRequest[];
}): ProfileAccomplishment[] => {
  const mergedAtByEvidenceKey = new Map<string, string | null>();
  for (const pullRequest of pullRequests) {
    const key = toEvidenceKey({
      repo: pullRequest.repo,
      pr: getPullRequestNumber(pullRequest),
    });
    mergedAtByEvidenceKey.set(key, pullRequest.mergedAt);
  }

  return accomplishments.map((accomplishment) => ({
    ...accomplishment,
    evidence: accomplishment.evidence.map((evidence) => {
      const pr = toPrNumber(evidence.pr);
      const key = toEvidenceKey({ repo: evidence.repo, pr });
      const mergedAt = mergedAtByEvidenceKey.has(key)
        ? (mergedAtByEvidenceKey.get(key) ?? null)
        : evidence.mergedAt;
      return { ...evidence, pr, mergedAt };
    }),
  }));
};
