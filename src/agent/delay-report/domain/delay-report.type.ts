import {
  ActiveRunSnapshot,
  FailedRunDetail,
  RecentlyFinishedRun,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { BlockReasonKind } from '../../../common/domain/block-reason';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';

// 조회 축 이름. 수집(usecase)과 우선순위 판정(attribute-delay)이 같은 문자열을 봐야 하므로
// 한 곳에 둔다 — 갈리면 매칭이 조용히 실패해 "확인 못 한 축" 판정이 통째로 죽는다.
export const AXIS_APPROVAL = '승인 대기 카드';
export const AXIS_ACTIVE_RUN = '진행 중 작업';
export const AXIS_FAILED_RUN = '최근 실패';
export const AXIS_FINISHED_RUN = '최근 종료 상태';

export interface DelayReportIntegrations {
  githubConfigured: boolean;
  notionConfigured: boolean;
}

export interface DelayReportInput {
  openPreviews: PreviewAction[];
  activeRuns: ActiveRunSnapshot[];
  failedRuns: FailedRunDetail[];
  recentlyFinished: RecentlyFinishedRun[];
  integrations: DelayReportIntegrations;
  now: Date;
  unavailableAxes: string[];
}

export type DelayCause =
  | 'APPROVAL_WAIT'
  | 'RUN_IN_PROGRESS'
  | 'UNRESOLVED_FAILURE'
  | 'NONE';

// 실패의 성격. 조치 문구가 유형마다 다르므로(연동은 .env, 쿼터는 리셋 대기, 그 밖은 일반 재시도)
// 문구를 만드는 쪽이 아니라 판정하는 쪽이 정한다. 부류와 문구는 BLOCK_REASON 사전이 정본이고,
// 'OTHER' 는 사전이 못 알아본 실패 — 아는 척하는 조치 대신 일반 재시도만 안내한다.
export type FailureKind = BlockReasonKind | 'OTHER';

export interface DelayVerdict {
  primaryCause: DelayCause;
  detail: string;
  secondaryNotes: string[];
  unavailableAxes: string[];
  // UNRESOLVED_FAILURE 일 때 재시도 안내에 실을 실패 run id. `/retry-run` 은 id 가 필수라
  // (`retry-run.handler.ts:103`) 이 값이 없으면 명령을 안내해도 사용자가 실행할 수 없다.
  retryRunId?: number | null;
  // 선택된 원인보다 앞선 우선순위인데 조회하지 못한 축. 비어 있지 않으면 이 원인이 정말 첫
  // 원인인지 단정할 수 없다는 뜻이라, 문구에서 단정을 걷는다.
  unverifiedHigherPriority: string[];
  // 관측은 됐지만 결론을 흔드는 신호(멈춤 의심 run 등). NONE 인데 이게 있으면 "지연 없음" 으로
  // 닫지 않는다 — 보조 메모와 결론이 서로 모순되면 안 된다.
  inconclusiveNotes: string[];
  // UNRESOLVED_FAILURE 일 때 실패의 성격. 일반 실패에 연동·쿼터 조치를 안내하지 않기 위해 쓴다.
  failureKind?: FailureKind;
}

export interface UnresolvedFailure {
  failure: FailedRunDetail;
  runId: number | null;
}
