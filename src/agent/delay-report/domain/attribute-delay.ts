import { toTaskLabel } from '../../../agent-registry/agent-registry';
import {
  describeFailureReason,
  STALE_RUN_THRESHOLD_MINUTES,
} from '../../../agent-run/domain/agent-run.type';
import {
  ActiveRunSnapshot,
  FailedRunDetail,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import {
  BLOCK_REASON_PHRASES,
  classifyBlockReason,
} from '../../../common/domain/block-reason';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
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
  'APPLY_FAILED',
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
      `${toTaskLabel(run.agentType)} 실행이 ${minutesSince(run.startedAt, now)}분째 멈췄을 가능성이 있어요. 자동 정리가 돌 때까지 진행 중으로 단정하지 않습니다.`,
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
  const task = toTaskLabel(failure.agentType);
  const reason = describeFailureReason(failure.reason);
  switch (kind) {
    case 'INTEGRATION':
      return `${task} 실행이 미연동 상태라 실패했어요. ${reason}`;
    case 'QUOTA':
      return `ChatGPT 사용량 한도 초과로 ${task} 실행이 실패했어요. ${reason}`;
    case 'PREREQUISITE':
      return `${task} 실행이 선행 산출물 부재로 실패했어요. ${reason}`;
    case 'OTHER':
      return `${task} 실행이 실패했어요. ${reason}`;
  }
};

// 반영이 실패해도 카드는 PENDING 으로 남는다(재승인으로 이어서 반영하려고). 그래서 status 만 보면
// "승인 눌렀는데 Meta 가 거부한" 카드가 승인 대기로 섞여, 더 오래된 다른 카드가 원인으로 뽑혔다
// (2026-11-08 run 11915: 인스타 반영 실패 스레드에서 묻자 822분 된 블로그 카드를 답했다).
// 우선순위: 질문한 스레드의 카드 > 가장 최근 반영 실패 > 가장 오래된 승인 대기.
const pickPreviewSubject = ({
  previews,
  askedThreadTs,
}: {
  previews: PreviewAction[];
  askedThreadTs: string | null;
}): PreviewAction | undefined => {
  // askedThreadTs 가 null 이면 고르지 않는다 — 스레드 밖 카드(slackThreadTs=null)와 맞아떨어지면 안 된다.
  const threadPreview = previews.find(
    (preview) =>
      askedThreadTs !== null && preview.slackThreadTs === askedThreadTs,
  );
  if (threadPreview !== undefined) {
    return threadPreview;
  }
  const [latestFailed] = previews
    .filter((preview) => preview.lastFailedAt !== null)
    .sort(
      (left, right) =>
        (right.lastFailedAt?.getTime() ?? 0) -
        (left.lastFailedAt?.getTime() ?? 0),
    );
  if (latestFailed !== undefined) {
    return latestFailed;
  }
  const [oldest] = [...previews].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  return oldest;
};

// 카드 본문은 릴스 캡션처럼 수십 줄일 수 있다 — 어느 카드인지는 첫 줄(제목 줄)이면 충분하다.
const cardTitle = (preview: PreviewAction): string =>
  preview.previewText.split('\n')[0];

const applyFailedDetail = ({
  preview,
  now,
}: {
  preview: PreviewAction;
  now: Date;
}): string => {
  // 사후 조회용 단계 표식(`[apply]` 등)은 벗긴다 — 콘솔 승인 뷰(toConsoleApproval)와 같은 처리.
  const reason = (preview.lastFailureReason ?? '사유 미기록').replace(
    /^\[[^\]]*\]\s*/,
    '',
  );
  // lastFailedAt 은 실패 시각이 아니라 그 시도의 시작 시각이다(#991) — 문구도 "마지막 시도" 로 쓴다.
  const failedAgo = preview.lastFailedAt
    ? minutesSince(preview.lastFailedAt, now)
    : 0;
  // endedAt 이 없다고 지금 도는 것은 아니다 — 프로세스가 죽어도 이렇게 남는다(생존은 부팅 재개 훅이 pid 로
  // 따로 본다). 그래서 진행 중이라 단정하지 않는다(#997 리뷰).
  const retrying =
    preview.applyProgress !== null &&
    preview.applyProgress.endedAt === undefined
      ? [
          '마지막 시도가 끝났다는 기록이 없어요. 아직 반영 중이거나 중간에 멈췄을 수 있어요.',
        ]
      : [];
  const lines = [
    `승인은 됐지만 반영이 실패했어요(마지막 시도 ${failedAgo}분 전).`,
    `카드: ${cardTitle(preview)}`,
    `사유: ${reason}`,
    ...retrying,
  ];
  return lines.join('\n');
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

  const subject = pickPreviewSubject({
    previews: validPreviews,
    askedThreadTs: input.askedThreadTs,
  });
  if (subject !== undefined) {
    // 나머지도 반영 실패와 승인 대기를 나눠 센다 — 합치면 실패 카드를 승인 대기라고 말한다(#997 리뷰).
    const others = validPreviews.filter((preview) => preview !== subject);
    const failedCount = others.filter(
      (preview) => preview.lastFailedAt !== null,
    ).length;
    const waitingCount = others.length - failedCount;
    if (failedCount > 0) {
      secondaryNotes.push(`반영이 실패한 카드가 ${failedCount}개 더 있어요.`);
    }
    if (waitingCount > 0) {
      secondaryNotes.push(`승인 대기 카드가 ${waitingCount}개 더 있어요.`);
    }
    if (subject.lastFailedAt !== null) {
      return withContext(
        'APPLY_FAILED',
        applyFailedDetail({ preview: subject, now: input.now }),
      );
    }
    return withContext(
      'APPROVAL_WAIT',
      `승인을 ${minutesSince(subject.createdAt, input.now)}분째 기다리는 카드가 있어요.\n카드: ${cardTitle(subject)}`,
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
      `${toTaskLabel(oldestRun.agentType)} 실행이 ${minutesSince(oldestRun.startedAt, input.now)}분째 진행 중이에요. ${STALE_RUN_THRESHOLD_MINUTES}분 안쪽이라 정상 범위입니다.`,
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
