import { ConfigService } from '@nestjs/config';

import {
  AgentRunRepositoryPort,
  LatestSweepReview,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { IdaeriRouterPort } from '../../router/domain/idaeri-router.port';
import { SlackService } from '../../slack/slack.service';
import {
  SubconsciousProposalRecord,
  SubconsciousProposalRepository,
} from '../domain/port/subconscious-proposal.repository.port';
import { GateDecision, StateChange } from '../domain/subconscious.type';
import {
  SubconsciousProposalException,
  SubconsciousProposalService,
} from './subconscious-proposal.service';

// ── 픽스처 헬퍼 ────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-26T10:00:00.000Z');
const OWNER = 'U-owner';
const OTHER_USER = 'U-other';

const buildRecord = (
  overrides: Partial<SubconsciousProposalRecord> = {},
): SubconsciousProposalRecord => ({
  id: 1,
  ownerUserId: OWNER,
  sourceId: 'github:pr',
  changeKey: 'github:pr:owner/repo#1',
  suggestedAgentType: 'CODE_REVIEWER' as AgentType,
  proposalText: 'PR #1 리뷰 제안',
  contextJson: { change: buildChange() },
  status: 'PENDING',
  slackChannelId: null,
  slackMessageTs: null,
  createdAt: new Date('2026-06-26T09:00:00.000Z'),
  resolvedAt: null,
  ...overrides,
});

const buildChange = (): StateChange => ({
  sourceId: 'github:pr',
  kind: 'added',
  item: {
    key: 'github:pr:owner/repo#1',
    fingerprint: 'abc',
    summary: 'PR #1 opened',
  },
});

const buildDecision = (
  overrides: Partial<GateDecision> = {},
): GateDecision => ({
  changeKey: 'github:pr:owner/repo#1',
  promote: true,
  reason: 'new PR',
  suggestedAgentType: 'CODE_REVIEWER' as AgentType,
  proposalText: 'PR #1 리뷰 제안',
  ...overrides,
});

// ── 가짜 의존성 ────────────────────────────────────────────────────────────

const buildRepository = (
  record: SubconsciousProposalRecord | null = buildRecord(),
  transitionFromPendingResult: boolean = true,
): jest.Mocked<SubconsciousProposalRepository> => ({
  create: jest.fn().mockImplementation(() => Promise.resolve(buildRecord())),
  findById: jest.fn().mockResolvedValue(record),
  hasPending: jest.fn().mockResolvedValue(false),
  markStatus: jest.fn().mockResolvedValue(undefined),
  transitionFromPending: jest
    .fn()
    .mockResolvedValue(transitionFromPendingResult),
  attachSlackMessage: jest.fn().mockResolvedValue(undefined),
});

// 서비스가 쓰는 것은 findLatestSweepReview 하나뿐이라 그 표면만 가짜로 만든다.
type SweepReviewLedger = jest.Mocked<
  Pick<AgentRunRepositoryPort, 'findLatestSweepReview'>
>;

const buildAgentRunRepository = (
  latest: LatestSweepReview | null = null,
): SweepReviewLedger => ({
  findLatestSweepReview: jest.fn().mockResolvedValue(latest),
});

const buildRouter = (): jest.Mocked<IdaeriRouterPort> => ({
  dispatch: jest.fn().mockResolvedValue({
    agentRunId: 42,
    workerType: 'CODE_REVIEWER' as AgentType,
    output: {},
    modelUsed: 'claude',
    formattedText: 'done',
  }),
});

const buildSlackService = (): jest.Mocked<
  Pick<SlackService, 'postProposalMessage'>
> => ({
  postProposalMessage: jest
    .fn()
    .mockResolvedValue({ channelId: 'C-dm', messageTs: '1234.5678' }),
});

const buildConfigService = (
  ttlMs?: number,
  env: Record<string, string> = {},
): jest.Mocked<ConfigService> =>
  ({
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'SUBCONSCIOUS_PROPOSAL_TTL_MS') {
        return ttlMs !== undefined ? String(ttlMs) : undefined;
      }
      return env[key];
    }),
  }) as unknown as jest.Mocked<ConfigService>;

const buildService = ({
  repository,
  router = buildRouter(),
  slack = buildSlackService(),
  ttlMs,
  transitionFromPendingResult,
  env,
  agentRunRepository,
}: {
  repository?: jest.Mocked<SubconsciousProposalRepository>;
  router?: jest.Mocked<IdaeriRouterPort>;
  slack?: jest.Mocked<Pick<SlackService, 'postProposalMessage'>>;
  ttlMs?: number;
  transitionFromPendingResult?: boolean;
  env?: Record<string, string>;
  agentRunRepository?: SweepReviewLedger;
} = {}): {
  service: SubconsciousProposalService;
  repository: jest.Mocked<SubconsciousProposalRepository>;
  router: jest.Mocked<IdaeriRouterPort>;
  slack: jest.Mocked<Pick<SlackService, 'postProposalMessage'>>;
  agentRunRepository: SweepReviewLedger;
} => {
  const resolvedRepository =
    repository ?? buildRepository(buildRecord(), transitionFromPendingResult);
  const configService = buildConfigService(ttlMs, env);
  const resolvedAgentRunRepository =
    agentRunRepository ?? buildAgentRunRepository();
  const service = new SubconsciousProposalService(
    resolvedRepository,
    router,
    slack as unknown as SlackService,
    configService,
    resolvedAgentRunRepository as unknown as AgentRunRepositoryPort,
  );
  return {
    service,
    repository: resolvedRepository,
    router,
    slack,
    agentRunRepository: resolvedAgentRunRepository,
  };
};

// ── shouldEmit ─────────────────────────────────────────────────────────────

describe('SubconsciousProposalService.shouldEmit', () => {
  const SUCCEEDED_PUBLISHED: LatestSweepReview = {
    status: 'SUCCEEDED',
    startedAt: new Date('2026-06-26T08:00:00.000Z'),
    dryRun: false,
  };

  it('스윕이 이미 리뷰·게시한 PR 이면 false', async () => {
    const { service, repository } = buildService({
      agentRunRepository: buildAgentRunRepository(SUCCEEDED_PUBLISHED),
    });

    const result = await service.shouldEmit({
      ownerUserId: OWNER,
      decision: buildDecision(),
    });

    expect(result).toBe(false);
    // 스윕 판정에서 걸렸으면 중복 조회까지 갈 필요가 없다.
    expect(repository.hasPending).not.toHaveBeenCalled();
  });

  it('스윕이 연습 모드(dryRun)로 끝난 PR 이면 게시가 없었으므로 true', async () => {
    const { service } = buildService({
      agentRunRepository: buildAgentRunRepository({
        ...SUCCEEDED_PUBLISHED,
        dryRun: true,
      }),
    });

    const result = await service.shouldEmit({
      ownerUserId: OWNER,
      decision: buildDecision(),
    });

    expect(result).toBe(true);
  });

  it('스윕 리뷰가 실패로 끝났으면 true', async () => {
    const { service } = buildService({
      agentRunRepository: buildAgentRunRepository({
        ...SUCCEEDED_PUBLISHED,
        status: 'FAILED',
      }),
    });

    const result = await service.shouldEmit({
      ownerUserId: OWNER,
      decision: buildDecision(),
    });

    expect(result).toBe(true);
  });

  it('스윕이 리뷰한 적 없는 PR 이면 true (스윕 대상 밖 PR 의 리뷰 경로 보존)', async () => {
    const { service } = buildService({
      agentRunRepository: buildAgentRunRepository(null),
    });

    const result = await service.shouldEmit({
      ownerUserId: OWNER,
      decision: buildDecision(),
    });

    expect(result).toBe(true);
  });

  it('CODE_REVIEWER 가 아니면 스윕 원장을 조회하지 않는다', async () => {
    const agentRunRepository = buildAgentRunRepository(SUCCEEDED_PUBLISHED);
    const { service } = buildService({ agentRunRepository });

    const result = await service.shouldEmit({
      ownerUserId: OWNER,
      decision: buildDecision({
        suggestedAgentType: 'PM' as AgentType,
        changeKey: 'notion:page:abc',
      }),
    });

    expect(result).toBe(true);
    expect(agentRunRepository.findLatestSweepReview).not.toHaveBeenCalled();
  });

  it('같은 대상에 미응답 카드가 있으면 false', async () => {
    const repository = buildRepository();
    repository.hasPending.mockResolvedValue(true);
    const { service } = buildService({ repository });

    const result = await service.shouldEmit({
      ownerUserId: OWNER,
      decision: buildDecision(),
    });

    expect(result).toBe(false);
  });

  it('중복 판정은 TTL 안쪽 카드만 센다 — 만료 카드가 제안을 영구히 막지 않게', async () => {
    const repository = buildRepository();
    const { service } = buildService({ repository, ttlMs: 3_600_000 });

    await service.shouldEmit({
      ownerUserId: OWNER,
      decision: buildDecision(),
    });

    const [, , createdAfter] = repository.hasPending.mock.calls[0]!;
    const elapsedMs = Date.now() - (createdAfter as Date).getTime();
    expect(elapsedMs).toBeGreaterThanOrEqual(3_600_000);
    expect(elapsedMs).toBeLessThan(3_600_000 + 5_000);
  });
});

// ── emit ───────────────────────────────────────────────────────────────────

describe('SubconsciousProposalService.emit', () => {
  it('PENDING proposal 생성 후 Slack DM 발송 → channelId/ts 저장', async () => {
    const { service, repository, slack } = buildService();
    await service.emit({
      ownerUserId: OWNER,
      change: buildChange(),
      decision: buildDecision(),
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: OWNER,
        suggestedAgentType: 'CODE_REVIEWER',
      }),
    );
    expect(slack.postProposalMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: OWNER, proposalId: 1 }),
    );
    expect(repository.attachSlackMessage).toHaveBeenCalledWith(
      1,
      'C-dm',
      '1234.5678',
    );
  });

  it('Slack 발송 실패해도 proposal DB row 는 살아남는다 (graceful)', async () => {
    const repository = buildRepository();
    const slack = buildSlackService();
    slack.postProposalMessage.mockRejectedValueOnce(
      new Error('Slack 봇 비활성'),
    );
    const { service } = buildService({ repository, slack });

    await expect(
      service.emit({
        ownerUserId: OWNER,
        change: buildChange(),
        decision: buildDecision(),
      }),
    ).resolves.toBeUndefined();

    expect(repository.create).toHaveBeenCalled();
    expect(repository.attachSlackMessage).not.toHaveBeenCalled();
  });
});

// ── apply ──────────────────────────────────────────────────────────────────

describe('SubconsciousProposalService.apply', () => {
  it('owner + PENDING + TTL 통과 → DISPATCHED 전이 + router.dispatch 호출', async () => {
    const repository = buildRepository(buildRecord(), true);
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    const result = await service.apply(1, OWNER, NOW);

    expect(repository.transitionFromPending).toHaveBeenCalledWith(
      1,
      'DISPATCHED',
      expect.any(Date),
    );
    expect(router.dispatch).toHaveBeenCalledTimes(1);
    expect(result).toContain('CODE_REVIEWER');
  });

  it('CODE_REVIEWER + github:pr key → dispatch text 는 key 에서 복원한 PR 참조(owner/repo#num)', async () => {
    const repository = buildRepository(buildRecord(), true);
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await service.apply(1, OWNER, NOW);

    // review-pr 은 text 에서 PR 참조를 파싱한다 — 사람용 요약('PR #1 opened')이 아니라
    // 안정 키에서 'github:pr:' 접두어를 벗긴 'owner/repo#1' 을 넘겨야 파싱된다.
    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'owner/repo#1' }),
    );
  });

  it('BE_FIX + github:pr key → dispatch text 는 PR 참조', async () => {
    const repository = buildRepository(
      buildRecord({ suggestedAgentType: 'BE_FIX' as AgentType }),
      true,
    );
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await service.apply(1, OWNER, NOW);

    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'owner/repo#1' }),
    );
  });

  it('BE + github:pr key → text 는 요약 유지 + prReferenceHint 로 PR 참조 동봉', async () => {
    const repository = buildRepository(
      buildRecord({ suggestedAgentType: 'BE' as AgentType }),
      true,
    );
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await service.apply(1, OWNER, NOW);

    // BE 는 작업 설명(요약)으로 plan 을 세우되 PR 참조가 있으면 GitHub 본문을 ground 한다.
    // 둘을 각각 넘겨야 fetch 실패 시에도 요약으로 계속 진행할 수 있다.
    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'PR #1 opened',
        prReferenceHint: 'owner/repo#1',
      }),
    );
  });

  it('PR 참조가 필요 없는 워커(PM) → dispatch text 는 사람용 요약(summary) 유지 + hint 미전파', async () => {
    const repository = buildRepository(
      buildRecord({ suggestedAgentType: 'PM' as AgentType }),
      true,
    );
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await service.apply(1, OWNER, NOW);

    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'PR #1 opened' }),
    );
    expect(router.dispatch.mock.calls[0][0]).not.toHaveProperty(
      'prReferenceHint',
    );
  });

  it('BE + 비 github:pr key(notion) → hint 없이 요약만 전달', async () => {
    const notionChange: StateChange = {
      sourceId: 'notion',
      kind: 'added',
      item: {
        key: 'notion:page-abc',
        fingerprint: 'def',
        summary: '스프린트 회고 준비',
      },
    };
    const repository = buildRepository(
      buildRecord({
        suggestedAgentType: 'BE' as AgentType,
        changeKey: 'notion:page-abc',
        contextJson: { change: notionChange },
      }),
      true,
    );
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await service.apply(1, OWNER, NOW);

    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ text: '스프린트 회고 준비' }),
    );
    expect(router.dispatch.mock.calls[0][0]).not.toHaveProperty(
      'prReferenceHint',
    );
  });

  it('다른 사용자가 apply → FORBIDDEN 예외, status 변경 없음, dispatch 없음', async () => {
    const repository = buildRepository(buildRecord({ ownerUserId: OWNER }));
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await expect(service.apply(1, OTHER_USER, NOW)).rejects.toMatchObject({
      status: DomainStatus.FORBIDDEN,
    });
    expect(repository.markStatus).not.toHaveBeenCalled();
    expect(router.dispatch).not.toHaveBeenCalled();
  });

  it('이미 DISPATCHED 인 proposal → PRECONDITION_FAILED, dispatch 없음', async () => {
    const repository = buildRepository(buildRecord({ status: 'DISPATCHED' }));
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await expect(service.apply(1, OWNER, NOW)).rejects.toMatchObject({
      status: DomainStatus.PRECONDITION_FAILED,
    });
    expect(router.dispatch).not.toHaveBeenCalled();
  });

  it('owner + PENDING + TTL 통과이나 transitionFromPending 이 false (경쟁 조건) → PRECONDITION_FAILED, dispatch 없음', async () => {
    const repository = buildRepository(buildRecord(), false);
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    await expect(service.apply(1, OWNER, NOW)).rejects.toMatchObject({
      status: DomainStatus.PRECONDITION_FAILED,
    });
    expect(router.dispatch).not.toHaveBeenCalled();
  });

  it('TTL 초과 → PRECONDITION_FAILED, dispatch 없음', async () => {
    // createdAt NOW-2h, ttlMs 1h → 만료
    const createdAt = new Date(NOW.getTime() - 2 * 3_600_000);
    const repository = buildRepository(buildRecord({ createdAt }));
    const router = buildRouter();
    const { service } = buildService({ repository, router, ttlMs: 3_600_000 });

    await expect(service.apply(1, OWNER, NOW)).rejects.toMatchObject({
      status: DomainStatus.PRECONDITION_FAILED,
    });
    expect(router.dispatch).not.toHaveBeenCalled();
    expect(repository.markStatus).not.toHaveBeenCalled();
  });

  it('proposal 미존재 → NOT_FOUND', async () => {
    const repository = buildRepository(null);
    const { service } = buildService({ repository });

    await expect(service.apply(999, OWNER, NOW)).rejects.toMatchObject({
      status: DomainStatus.NOT_FOUND,
    });
  });

  it('apply 예외는 SubconsciousProposalException 인스턴스', async () => {
    const repository = buildRepository(null);
    const { service } = buildService({ repository });

    const error = await service.apply(999, OWNER, NOW).catch((e) => e);
    expect(error).toBeInstanceOf(SubconsciousProposalException);
  });
});

// ── dismiss ────────────────────────────────────────────────────────────────

describe('SubconsciousProposalService.dismiss', () => {
  it('owner + PENDING → DISMISSED 전이', async () => {
    const repository = buildRepository(buildRecord(), true);
    const { service } = buildService({ repository });

    await service.dismiss(1, OWNER);

    expect(repository.transitionFromPending).toHaveBeenCalledWith(
      1,
      'DISMISSED',
      expect.any(Date),
    );
  });

  it('다른 사용자가 dismiss → FORBIDDEN, status 변경 없음', async () => {
    const repository = buildRepository(buildRecord({ ownerUserId: OWNER }));
    const { service } = buildService({ repository });

    await expect(service.dismiss(1, OTHER_USER)).rejects.toMatchObject({
      status: DomainStatus.FORBIDDEN,
    });
    expect(repository.markStatus).not.toHaveBeenCalled();
  });

  it('이미 DISMISSED 인 proposal → PRECONDITION_FAILED', async () => {
    const repository = buildRepository(buildRecord({ status: 'DISMISSED' }));
    const { service } = buildService({ repository });

    await expect(service.dismiss(1, OWNER)).rejects.toMatchObject({
      status: DomainStatus.PRECONDITION_FAILED,
    });
    expect(repository.markStatus).not.toHaveBeenCalled();
  });

  it('proposal 미존재 → NOT_FOUND', async () => {
    const repository = buildRepository(null);
    const { service } = buildService({ repository });

    await expect(service.dismiss(999, OWNER)).rejects.toMatchObject({
      status: DomainStatus.NOT_FOUND,
    });
  });
});
