import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';

export const IDAERI_REVIEW_MARKER = '🤖 **이대리 자동 리뷰**';

export interface BuildFindingCommentBodyInput {
  category: FindingCategory;
  severity: FindingSeverity;
  body: string;
}

export const buildFindingCommentBody = ({
  category,
  severity,
  body,
}: BuildFindingCommentBodyInput): string =>
  `${IDAERI_REVIEW_MARKER} · ${category} / ${severity}\n\n${body.trim()}`;

// 지적 0건으로 끝난 스윕 리뷰가 PR 에 남기는 코멘트.
//
// 지적 카드가 아니므로 pr_review_finding 에 적재하지 않는다 — 수확기는 저장된 카드의
// commentId 로 스레드를 찾으므로(harvest-signal.ts:30-33) 이 코멘트는 애초에 판정 대상이
// 아니고, 마커로 시작해 같은 스레드의 답글 필터에서도 자기 글로 걸러진다(같은 파일 44).
//
// 요약은 한 줄로 눌러 인용한다. 모델이 줄바꿈을 섞으면 두 번째 줄부터 인용 밖으로 나가
// 코멘트가 두 문단으로 갈라진다. 스키마 검사는 summary 가 문자열이기만 하면 통과시키므로
// (pr-review.parser.ts:81) 빈 값이 올 수 있다 — 그때는 인용 줄째로 뺀다.
//
// 판단 보류(undeterminedReason 있음)면 "지적 없음" 이라고 쓰지 않는다. 잘린 diff 를 본 리뷰가
// "머지 전에 고칠 것을 찾지 못했다" 고 남기면 읽는 사람은 안전하다는 뜻으로 받는다 — 실제로는
// 못 본 것이다. 마커로 시작하는 것은 같다(수확기가 자기 글로 거르는 기준).
//
// 잘린 diff 를 봤으면 coverageNote(buildDiffCoverageNote)를 끝에 붙인다.
export const buildNoFindingsCommentBody = (
  summary: string,
  undeterminedReason?: string,
  coverageNote?: string | null,
): string => {
  const flattened = summary.trim().replace(/\s*\n+\s*/g, ' ');
  const quoted = flattened.length > 0 ? `\n\n> ${flattened}` : '';
  const coverage = coverageNote ? `\n\n${coverageNote}` : '';
  if (undeterminedReason !== undefined) {
    const reason = undeterminedReason.trim().replace(/\s*\n+\s*/g, ' ');
    return `${IDAERI_REVIEW_MARKER} · 판단 보류\n\n머지 가부를 판단할 근거가 부족해 판단하지 않았습니다 — ${reason}${quoted}${coverage}`;
  }
  return `${IDAERI_REVIEW_MARKER} · 지적 사항 없음\n\n이번 diff 에서 머지 전에 고쳐야 할 것을 찾지 못했습니다.${quoted}${coverage}`;
};

// diff 가 상한에서 잘렸으면 몇 바이트를 봤는지 코드가 직접 적는다. 모델에게도 잘렸다고 알리지만
// (buildReviewPrompt) 그 사실을 게시물에 옮길지는 모델 몫이었고, 잘린 PR 9건 중 8건이 밝히지
// 않은 채 앞부분만 리뷰했다. 안 잘렸으면 null.
export const buildDiffCoverageNote = (
  reviewedDiff: string,
  totalBytes: number,
): string | null => {
  const reviewedBytes = Buffer.byteLength(reviewedDiff, 'utf-8');
  if (reviewedBytes >= totalBytes) {
    return null;
  }
  const format = (value: number): string => value.toLocaleString('en-US');
  return `⚠️ diff ${format(reviewedBytes)}/${format(totalBytes)} 바이트만 검토 — 상한을 넘은 뒷부분은 보지 못했습니다(테스트 파일을 뒤로 미뤄 자름).`;
};

// 지적을 게시한 리뷰가 잘린 diff 를 봤을 때 PR 에 따로 남기는 안내. 지적 카드가 아니라
// pr_review_finding 에 적재하지 않고, 마커로 시작해 수확기의 자기 글 필터를 탄다.
export const buildPartialReviewCommentBody = (coverageNote: string): string =>
  `${IDAERI_REVIEW_MARKER} · 부분 검토\n\n${coverageNote}`;
