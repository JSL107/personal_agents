import { STALE_RUN_THRESHOLD_MINUTES } from '../../../agent-run/domain/agent-run.type';
import {
  ActiveRunSnapshot,
  FailedRunDetail,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { DelayReportInput, DelayVerdict } from './delay-report.type';

const MINUTE_MS = 60 * 1000;
// 원장에는 errorCode가 아니라 예외 message만 저장된다. 실측 문구는
// `src/github/infrastructure/octokit-github.client.ts`의 `GITHUB_TOKEN 이 .env 에 설정되지 않아...`와
// `src/notion/infrastructure/notion-api.client.ts`의 `NOTION_TOKEN 이 .env 에 설정되지 않아...`다.
// 레포 전반에는 `... 가 설정되지 않았습니다 (.env 확인).` 변형도 있다. 이 문자열 계약은
// 문구가 바뀌면 조용히 깨질 수 있으므로, errorCode를 원장에 보존하는 별도 변경 전까지 유지한다.
const CONFIGURATION_MISSING_SIGNAL = '설정되지 않';
const ENV_SIGNAL = '.env';

const minutesSince = (date: Date, now: Date): number => {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / MINUTE_MS));
};

const isFreshRun = (run: ActiveRunSnapshot, now: Date): boolean => {
  return minutesSince(run.startedAt, now) < STALE_RUN_THRESHOLD_MINUTES;
};

const buildIntegrationNotes = (
  integrations: DelayReportInput['integrations'],
): string[] => {
  const notes: string[] = [];
  if (!integrations.githubConfigured) {
    notes.push(
      'GitHub가 아직 연동 전이라 관련 작업은 못 읽어요. 없는 값을 지어내지 않습니다. 연동되면 바로 돌아요.',
    );
  }
  if (!integrations.notionConfigured) {
    notes.push(
      'Notion이 아직 연동 전이라 관련 작업은 못 읽어요. 없는 값을 지어내지 않습니다. 연동되면 바로 돌아요.',
    );
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
): FailedRunDetail | null => {
  const unresolvedAgentTypes = new Set(
    recentlyFinished
      .filter((run) => run.status === 'FAILED')
      .map((run) => run.agentType),
  );
  const candidates = failedRuns
    .filter((run) => unresolvedAgentTypes.has(run.agentType))
    .sort((left, right) => right.endedAt.getTime() - left.endedAt.getTime());
  return candidates[0] ?? null;
};

const failureDetail = (failure: FailedRunDetail): string => {
  if (
    failure.reason.includes(CONFIGURATION_MISSING_SIGNAL) &&
    failure.reason.includes(ENV_SIGNAL)
  ) {
    return `${failure.agentType} 실행이 미연동 상태라 실패했어요. ${failure.reason} .env에 해당 키를 설정한 뒤 재실행해주세요.`;
  }
  if (failure.reason.includes('사용량 한도 초과')) {
    return `ChatGPT 사용량 한도 초과로 ${failure.agentType} 실행이 실패했어요. ${failure.reason}`;
  }
  return `${failure.agentType} 실행이 실패했어요. ${failure.reason}`;
};

export const attributeDelay = (input: DelayReportInput): DelayVerdict => {
  const validPreviews = input.openPreviews.filter(
    (preview) => preview.status === 'PENDING' && preview.expiresAt > input.now,
  );
  const secondaryNotes = [
    ...buildIntegrationNotes(input.integrations),
    ...buildStaleNotes(
      input.activeRuns.filter((run) => !isFreshRun(run, input.now)),
      input.now,
    ),
  ];

  if (validPreviews.length > 0) {
    const oldestPreview = [...validPreviews].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    )[0];
    const extraCount = validPreviews.length - 1;
    if (extraCount > 0) {
      secondaryNotes.push(`승인 대기 카드가 ${extraCount}개 더 있어요.`);
    }
    return {
      primaryCause: 'APPROVAL_WAIT',
      detail: `「${oldestPreview.previewText}」 카드가 ${minutesSince(oldestPreview.createdAt, input.now)}분째 대기 중이에요.`,
      secondaryNotes,
      unavailableAxes: input.unavailableAxes,
    };
  }

  const freshRuns = input.activeRuns
    .filter((run) => isFreshRun(run, input.now))
    .sort(
      (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
    );
  if (freshRuns.length > 0) {
    const oldestRun = freshRuns[0];
    return {
      primaryCause: 'RUN_IN_PROGRESS',
      detail: `${oldestRun.agentType}이(가) ${minutesSince(oldestRun.startedAt, input.now)}분째 작업 중이에요. 30분 안쪽이라 정상 범위입니다.`,
      secondaryNotes,
      unavailableAxes: input.unavailableAxes,
    };
  }

  const failure = findUnresolvedFailure(
    input.failedRuns,
    input.recentlyFinished,
  );
  if (failure !== null) {
    return {
      primaryCause: 'UNRESOLVED_FAILURE',
      detail: failureDetail(failure),
      secondaryNotes,
      unavailableAxes: input.unavailableAxes,
    };
  }

  return {
    primaryCause: 'NONE',
    detail: '',
    secondaryNotes,
    unavailableAxes: input.unavailableAxes,
  };
};
