import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  PullRequestDetail,
  PullRequestDiff,
} from '../../../github/domain/github.type';
import { ConversationContext } from '../../../router/domain/conversation-context.type';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ApprovalRecommendation = 'approve' | 'request_changes' | 'comment';

export interface ReviewCommentDraft {
  file?: string;
  line?: number;
  body: string;
}

// 지적 분류 — 시스템 프롬프트의 우선순위 6단을 펼친 것 (1단 = CORRECTNESS + SECURITY 로 분리).
// Phase 3 의 카테고리별 채택률 집계와 억제 면제 판정이 이 값에 의존한다.
export type FindingCategory =
  | 'CORRECTNESS' // 정확성·회귀·데이터 유실
  | 'SECURITY'
  | 'RELIABILITY' // 동시성·트랜잭션·에러 처리·외부 API graceful
  | 'TEST' // 커버리지 누락
  | 'ARCHITECTURE' // DDD / Port-Adapter 위반, 의존 방향
  | 'READABILITY' // 네이밍·가독성·중복
  | 'STYLE' // 포맷·주석·lint 영역
  | 'UNCLASSIFIED'; // 구버전 응답 호환 / 라벨 강등

export type FindingSeverity = 'MUST_FIX' | 'NICE_TO_HAVE' | 'MISSING_TEST';

export interface ReviewFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  file?: string;
  line?: number;
  body: string;
}

export interface PullRequestReview {
  summary: string;
  riskLevel: RiskLevel;
  mustFix: string[];
  niceToHave: string[];
  missingTests: string[];
  reviewCommentDrafts: ReviewCommentDraft[];
  approvalRecommendation: ApprovalRecommendation;
  // 지적 낱개 목록 — 카드(PrReviewFinding)의 원본. 파서가 항상 채운다.
  // 구버전 모델 응답(findings 없음)은 mustFix/niceToHave/missingTests 에서 변환된다.
  findings: ReviewFinding[];
}

export interface ReviewPullRequestInput {
  prRef: string; // URL 또는 "owner/repo#number"
  slackUserId: string;
  // 자동 트리거 (예: GitHub webhook pull_request.opened) 와 사용자 트리거를 구분하기 위한 옵션.
  // 미지정 시 SLACK_COMMAND_REVIEW_PR 로 기록.
  triggerType?: TriggerType;
  // 자연어 진입 시 router 가 전달하는 대화 맥락 — userInstruction(직전 대화 기반 사용자 지시)을
  // prompt [사용자 지시] 섹션으로 반영. 슬래시 /review-pr 진입은 미주입 (기존 동작).
  conversationContext?: ConversationContext;
  // PR 리뷰 스윕 전용 — 호출자가 이미 조회한 PR 스냅샷. 주입되면 usecase 는 재조회하지 않는다.
  // 스윕은 게시(인라인 앵커)에 detail.headSha 와 diff 를 쓰므로, 리뷰가 본 스냅샷과 게시가 쓰는
  // 스냅샷이 갈리면 앵커가 어긋난다 — 같은 조회 결과를 공유해 그 틈을 없앤다.
  snapshot?: {
    detail: PullRequestDetail;
    diff: PullRequestDiff;
  };
  // PR 리뷰 스윕 전용 — 이 리뷰가 연습 모드(게시 없음)로 돌았는지. inputSnapshot 에 남아
  // "연습 모드로 끝난 리뷰"를 실게시 전환 후 다시 리뷰할지 판정하는 근거가 된다.
  dryRun?: boolean;
}
