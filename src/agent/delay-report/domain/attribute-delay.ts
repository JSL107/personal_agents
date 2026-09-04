import { STALE_RUN_THRESHOLD_MINUTES } from '../../../agent-run/domain/agent-run.type';
import {
  ActiveRunSnapshot,
  FailedRunDetail,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import {
  BLOCK_REASON_PHRASES,
  classifyBlockReason,
} from '../../../common/domain/block-reason';
import {
  AXIS_ACTIVE_RUN,
  AXIS_APPROVAL,
  AXIS_FAILED_RUN,
  AXIS_FINISHED_RUN,
  DelayCause,
  DelayReportInput,
  DelayVerdict,
  FailureKind,
  UnresolvedFailure,
} from './delay-report.type';

const MINUTE_MS = 60 * 1000;

// 귀속 순서. 조회 축 하나가 죽은 채로 그 아래 원인을 "이게 원인" 이라고 확정하면 진짜 첫 원인을
// 놓친 채 단정하게 된다(승인 대기를 못 읽고 "진행 중이라 정상" 이라 답하는 식). 그래서 선택된
// 원인보다 앞선 축이 확인 불가면 그 사실을 판정에 실어 문구에서 단정을 걷는다.
const CAUSE_ORDER: DelayCause[] = [
  'APPROVAL_WAIT',
  'RUN_IN_PROGRESS',
  'UNRESOLVED_FAILURE',
  'NONE',
];
const AXIS_TO_CAUSE: Record<string, DelayCause> = {
  [AXIS_APPROVAL]: 'APPROVAL_WAIT',
  [AXIS_ACTIVE_RUN]: 'RUN_IN_PROGRESS',
  [AXIS_FAILED_RUN]: 'UNRESOLVED_FAILURE',
  [AXIS_FINISHED_RUN]: 'UNRESOLVED_FAILURE',
};

const findUnverifiedHigherPriority = (
  cause: DelayCause,
  unavailableAxes: string[],
): string[] => {
  const causeRank = CAUSE_ORDER.indexOf(cause);
  return unavailableAxes.filter((axis) => {
    const axisCause = AXIS_TO_CAUSE[axis];
    if (axisCause === undefined) {
      return false;
    }
    return CAUSE_ORDER.indexOf(axisCause) < causeRank;
  });
};

const minutesSince = (date: Date, now: Date): number => {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / MINUTE_MS));
};

const isFreshRun = (run: ActiveRunSnapshot, now: Date): boolean => {
  return minutesSince(run.startedAt, now) < STALE_RUN_THRESHOLD_MINUTES;
};

// 미연동 메모도 카드와 같은 상용구를 쓴다 — 같은 사정을 두 화면이 다른 말로 설명하면
// 대표가 다른 문제로 읽는다.
// subject 는 조사까지 붙여서 받는다 — 이름 끝 받침에 따라 조사가 갈리는데(GitHub'가' / Notion'이')
// 템플릿이 조사를 고정하면 한쪽이 조용히 틀린 문장이 된다.
const integrationNote = (subject: string): string => {
  const phrase = BLOCK_REASON_PHRASES.INTEGRATION;
  return `${subject} 아직 연동 전이라 관련 작업은 못 읽어요. ${phrase.noFabrication} ${phrase.recovery}`;
};

const buildIntegrationNotes = (
  integrations: DelayReportInput['integrations'],
): string[] => {
  const notes: string[] = [];
  if (!integrations.githubConfigured) {
    notes.push(integrationNote('GitHub가'));
  }
  if (!integrations.notionConfigured) {
    notes.push(integrationNote('Notion이'));
  }
  return notes;
};

const buildStaleNotes = (
  staleRuns: ActiveRunSnapshot[],
  now: Date,
): string[] => {
  return staleRuns.map(
    (run) =>
      `${run.agentType} 실행이 ${minutesSince(run.startedAt, now)}분째 멈췄을 가능성이 있어요. 주간 스위퍼가 정리할 때까지 진행 중으로 단정하지 않습니다.`,
  );
};

const findUnresolvedFailure = (
  failedRuns: FailedRunDetail[],
  recentlyFinished: DelayReportInput['recentlyFinished'],
): UnresolvedFailure | null => {
  // agentType 별 "최신 종료가 FAILED" 인 것만 미해소로 본다. 그 최신 종료가 곧 아래에서 고르는
  // 최신 실패라, 재시도 안내에 쓸 run id 를 여기서 함께 집는다(FailedRunDetail 에는 id 가 없다).
  const unresolvedRunIdByAgentType = new Map<string, number>(
    recentlyFinished
      .filter((run) => run.status === 'FAILED')
      .map((run) => [run.agentType, run.runId]),
  );
  const candidates = failedRuns
    .filter((run) => unresolvedRunIdByAgentType.has(run.agentType))
    .sort((left, right) => right.endedAt.getTime() - left.endedAt.getTime());
  const failure = candidates[0];
  if (failure === undefined) {
    return null;
  }
  return {
    failure,
    runId: unresolvedRunIdByAgentType.get(failure.agentType) ?? null,
  };
};

const failureDetail = (failure: FailedRunDetail, kind: FailureKind): string => {
  switch (kind) {
    case 'INTEGRATION':
      return `${failure.agentType} 실행이 미연동 상태라 실패했어요. ${failure.reason}`;
    case 'QUOTA':
      return `ChatGPT 사용량 한도 초과로 ${failure.agentType} 실행이 실패했어요. ${failure.reason}`;
    case 'PREREQUISITE':
      return `${failure.agentType} 실행이 선행 산출물 부재로 실패했어요. ${failure.reason}`;
    case 'OTHER':
      return `${failure.agentType} 실행이 실패했어요. ${failure.reason}`;
  }
};

export const attributeDelay = (input: DelayReportInput): DelayVerdict => {
  const validPreviews = input.openPreviews.filter(
    (preview) => preview.status === 'PENDING' && preview.expiresAt > input.now,
  );
  // 멈춤 의심 run 은 "관측했지만 결론을 흔드는 신호" 라 일반 보조 메모와 나눠 둔다.
  // 이게 있는데 "지연 없습니다" 로 닫으면 같은 응답 안에서 결론과 메모가 서로 어긋난다.
  const inconclusiveNotes = buildStaleNotes(
    input.activeRuns.filter((run) => !isFreshRun(run, input.now)),
    input.now,
  );
  const secondaryNotes = [
    ...buildIntegrationNotes(input.integrations),
    ...inconclusiveNotes,
  ];
  const withContext = (
    cause: DelayCause,
    detail: string,
    failure?: { retryRunId: number | null; kind: FailureKind },
  ): DelayVerdict => ({
    primaryCause: cause,
    detail,
    secondaryNotes,
    unavailableAxes: input.unavailableAxes,
    unverifiedHigherPriority: findUnverifiedHigherPriority(
      cause,
      input.unavailableAxes,
    ),
    inconclusiveNotes,
    ...(failure === undefined
      ? {}
      : { retryRunId: failure.retryRunId, failureKind: failure.kind }),
  });

  if (validPreviews.length > 0) {
    const oldestPreview = [...validPreviews].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    )[0];
    const extraCount = validPreviews.length - 1;
    if (extraCount > 0) {
      secondaryNotes.push(`승인 대기 카드가 ${extraCount}개 더 있어요.`);
    }
    return withContext(
      'APPROVAL_WAIT',
      `「${oldestPreview.previewText}」 카드가 ${minutesSince(oldestPreview.createdAt, input.now)}분째 대기 중이에요.`,
    );
  }

  const freshRuns = input.activeRuns
    .filter((run) => isFreshRun(run, input.now))
    .sort(
      (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
    );
  if (freshRuns.length > 0) {
    const oldestRun = freshRuns[0];
    return withContext(
      'RUN_IN_PROGRESS',
      `${oldestRun.agentType}이(가) ${minutesSince(oldestRun.startedAt, input.now)}분째 작업 중이에요. 30분 안쪽이라 정상 범위입니다.`,
    );
  }

  const unresolved = findUnresolvedFailure(
    input.failedRuns,
    input.recentlyFinished,
  );
  if (unresolved !== null) {
    const kind = classifyBlockReason(unresolved.failure.reason) ?? 'OTHER';
    return withContext(
      'UNRESOLVED_FAILURE',
      failureDetail(unresolved.failure, kind),
      { retryRunId: unresolved.runId, kind },
    );
  }

  return withContext('NONE', '');
};
