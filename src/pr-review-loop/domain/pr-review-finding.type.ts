import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';

// 카드 생애 상태. 채택률 집계(Phase 3)는 ACKED/FIXED/REJECTED 만 분모에 넣고
// OPEN(미열람)·STALE(결론 없이 PR 종료)·SUPPRESSED 는 제외한다.
export type FindingStatus =
  | 'OPEN'
  | 'ACKED'
  | 'REJECTED'
  | 'FIXED'
  // 과거 데이터 호환용. thread 종료를 status에 쓰면 직전 결론이 유실되므로 신규 기록은 resolvedAt을 쓴다.
  | 'RESOLVED'
  | 'STALE'
  | 'SUPPRESSED';

// 어떤 형태로 게시됐는지. 3단 폴백의 결과가 여기 남는다.
// 연습 모드는 DB 에 카드를 만들지 않으므로(정책 계산 + 집계만) 이 유니온에 값이 없다.
export type FindingPostMode =
  | 'INLINE'
  | 'FILE'
  | 'ISSUE_COMMENT'
  | 'NOT_POSTED';

export interface CreateFindingInput {
  agentRunId: number;
  agentType: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  category: FindingCategory;
  severity: FindingSeverity;
  filePath: string | null;
  line: number | null;
  body: string;
  fingerprint: string;
  postMode: FindingPostMode;
}

export interface PrReviewFindingRecord {
  id: number;
  agentRunId: number;
  repo: string;
  pullNumber: number;
  headSha: string;
  category: FindingCategory;
  severity: FindingSeverity;
  filePath: string | null;
  line: number | null;
  body: string;
  fingerprint: string;
  status: FindingStatus;
  postMode: FindingPostMode;
  githubCommentId: string | null;
  githubThreadNodeId: string | null;
  createdAt: Date;
}

export interface MarkPostedInput {
  id: number;
  postMode: FindingPostMode;
  githubCommentId: string | null;
  githubThreadNodeId: string | null;
}
