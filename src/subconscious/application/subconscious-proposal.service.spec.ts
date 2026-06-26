import { ConfigService } from '@nestjs/config';

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
): jest.Mocked<SubconsciousProposalRepository> => ({
  create: jest.fn().mockImplementation(() => Promise.resolve(buildRecord())),
  findById: jest.fn().mockResolvedValue(record),
  markStatus: jest.fn().mockResolvedValue(undefined),
  attachSlackMessage: jest.fn().mockResolvedValue(undefined),
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

const buildConfigService = (ttlMs?: number): jest.Mocked<ConfigService> =>
  ({
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'SUBCONSCIOUS_PROPOSAL_TTL_MS') {
        return ttlMs !== undefined ? String(ttlMs) : undefined;
      }
      return undefined;
    }),
  }) as unknown as jest.Mocked<ConfigService>;

const buildService = ({
  repository = buildRepository(),
  router = buildRouter(),
  slack = buildSlackService(),
  ttlMs,
}: {
  repository?: jest.Mocked<SubconsciousProposalRepository>;
  router?: jest.Mocked<IdaeriRouterPort>;
  slack?: jest.Mocked<Pick<SlackService, 'postProposalMessage'>>;
  ttlMs?: number;
} = {}): {
  service: SubconsciousProposalService;
  repository: jest.Mocked<SubconsciousProposalRepository>;
  router: jest.Mocked<IdaeriRouterPort>;
  slack: jest.Mocked<Pick<SlackService, 'postProposalMessage'>>;
} => {
  const configService = buildConfigService(ttlMs);
  const service = new SubconsciousProposalService(
    repository,
    router,
    slack as unknown as SlackService,
    configService,
  );
  return { service, repository, router, slack };
};

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
    const repository = buildRepository(buildRecord());
    const router = buildRouter();
    const { service } = buildService({ repository, router });

    const result = await service.apply(1, OWNER, NOW);

    expect(repository.markStatus).toHaveBeenCalledWith(
      1,
      'DISPATCHED',
      expect.any(Date),
    );
    expect(router.dispatch).toHaveBeenCalledTimes(1);
    expect(result).toContain('CODE_REVIEWER');
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
    const repository = buildRepository(buildRecord());
    const { service } = buildService({ repository });

    await service.dismiss(1, OWNER);

    expect(repository.markStatus).toHaveBeenCalledWith(
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
