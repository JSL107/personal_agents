import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentRunRange } from '../../../common/domain/agent-run-range.type';

export interface EvaluationInput {
  slackUserId: string;
  // 미지정 시 WEEK (review 권장 — 이력서/careerLog 의 자연 단위).
  range?: AgentRunRange;
  // 미지정 시 SLACK_COMMAND_PO_EVAL. CRON 자동 트리거 (Daily Eval) 시 DAILY_EVAL_CRON 으로 구분.
  triggerType?: TriggerType;
}

// 합성 input 으로 사용된 sub-agent 들의 run id. 일부 만 있을 수 있음 (graceful policy).
export interface SubAgentRunRefs {
  workReviewerRunId?: number;
  poShadowRunId?: number;
  impactReporterRunId?: number;
}

// PO 통합 facade 의 output.
// careerLog 는 사용자 외부 형식 (Notion 페이지 / 커리어 페이지) 미공유 상태에서 잠정 schema —
// 향후 사용자가 실제 형식 공유 시 정합 조정. schemaVersion 으로 호환 추적.
// (review omc:architect 권장 — 향후 schema 변경 시 Prisma output JSON 의 이전 row 와 구분.)
export interface EvaluationOutput {
  range: AgentRunRange;
  sourceAgentRuns: SubAgentRunRefs;
  qualitative: {
    summary: string; // 전반 한 줄 요약
    blockers: string[];
    wins: string[];
  };
  careerLog: {
    schemaVersion: 1;
    period: string; // 'YYYY-MM-DD' (TODAY) 또는 'YYYY-Wnn' (WEEK)
    achievements: {
      quantitative: string[]; // "PR 3건 머지", "BE-Schema 2건 적용"
      qualitative: string[]; // "Router 도입 완료" 형태
    };
    technologies: string[];
    impact: string; // 1~2 문장
  };
  // 신규 — range=TODAY 에서 오늘 머지된 PR 이 있을 때만. WEEK / PR 0건이면 undefined.
  // careerLog schemaVersion(=1) 과 무관 — PR 평가를 careerLog 밖으로 분리해 기존 schema 보존.
  mergedPrReview?: MergedPrReview;
}

// 오늘 머지 PR 평가 — LLM 은 prNumber + evaluation 만 생성하고, ref/title/url/stat 메타는
// usecase 가 GithubPullRequestSummary 에서 prNumber 로 join 한다 (LLM 환각 메타 방지).
export interface MergedPrEvaluation {
  prNumber: number;
  ref: string; // "owner/repo#N"
  title: string;
  url: string;
  additions: number;
  deletions: number;
  evaluation: string; // LLM 평가 1~2문장 (없으면 빈 문자열)
}

export interface MergedPrReview {
  overall: string;
  prs: MergedPrEvaluation[];
}
