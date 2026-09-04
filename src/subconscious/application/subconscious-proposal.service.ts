import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  DispatchInput,
  IDAERI_ROUTER_PORT,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { SlackService } from '../../slack/slack.service';
import type { ProposalEmitter } from '../domain/port/proposal-emitter.port';
import { PROPOSAL_EMITTER } from '../domain/port/proposal-emitter.port';
import {
  SUBCONSCIOUS_PROPOSAL_REPOSITORY,
  SubconsciousProposalRecord,
  SubconsciousProposalRepository,
} from '../domain/port/subconscious-proposal.repository.port';
import { GateDecision, StateChange } from '../domain/subconscious.type';

const DEFAULT_TTL_MS = 3_600_000; // 1시간

// review-pr(CODE_REVIEWER) 워커는 dispatch text 에서 PR 참조(owner/repo#num)를
// 파싱한다. 사람용 요약(PR 제목)은 파싱되지 않으므로, StateItem.key ('github:pr:owner/repo#num')
// 에서 'github:pr:' 접두어를 벗긴 참조를 넘긴다. PR 참조가 필요 없는 워커는 요약을 그대로 쓴다.
const GITHUB_PR_KEY_PREFIX = 'github:pr:';
const PR_REFERENCE_AGENT_TYPES: ReadonlySet<AgentType> = new Set([
  AgentType.CODE_REVIEWER,
]);

// 설명과 참조가 모두 필요하므로 text 를 덮어쓰지 않고 prReferenceHint 로 따로 동봉한다.
const PR_GROUNDING_AGENT_TYPES: ReadonlySet<AgentType> = new Set([]);

const extractPrReference = (changeKey: string): string | null =>
  changeKey.startsWith(GITHUB_PR_KEY_PREFIX)
    ? changeKey.slice(GITHUB_PR_KEY_PREFIX.length)
    : null;

// 스윕 리뷰 원장을 되짚는 범위. sweep-pr-reviews.usecase 의 동명 상수와 같은 값 —
// 스윕이 "이미 리뷰함"으로 판정하는 창과 카드 생략 창을 어긋나지 않게 맞춘다.
const SWEEP_REVIEW_LOOKBACK_DAYS = 30;

const resolveDispatchText = (
  agentType: AgentType,
  changeKey: string,
  summary: string,
): string => {
  if (PR_REFERENCE_AGENT_TYPES.has(agentType)) {
    return extractPrReference(changeKey) ?? summary;
  }
  return summary;
};

const resolvePrReferenceHint = (
  agentType: AgentType,
  changeKey: string,
): string | null =>
  PR_GROUNDING_AGENT_TYPES.has(agentType)
    ? extractPrReference(changeKey)
    : null;

// SubconsciousProposalService — ProposalEmitter 포트 구현체.
// emit: PENDING proposal 생성 → Slack DM 발송 (✅실행 / ❌무시 버튼) → slackChannelId/ts 기록.
// apply: owner+PENDING+TTL 검증 → DISPATCHED 전이 → IdaeriRouterUsecase.dispatch 호출.
// dismiss: owner+PENDING 검증 → DISMISSED 전이.
@Injectable()
export class SubconsciousProposalService implements ProposalEmitter {
  private readonly logger = new Logger(SubconsciousProposalService.name);

  private readonly ttlMs: number = DEFAULT_TTL_MS;

  constructor(
    @Inject(SUBCONSCIOUS_PROPOSAL_REPOSITORY)
    private readonly repository: SubconsciousProposalRepository,
    @Inject(IDAERI_ROUTER_PORT)
    private readonly router: IdaeriRouterPort,
    // 순환 의존성 해소: SubconsciousProposalService → SlackService →
    // SLACK_HANDLER_PORT(SubconsciousProposalActionHandler) → SubconsciousProposalService.
    // 모듈 forwardRef 만으로는 provider 생성자 순환이 안 풀려 부팅이 데드락된다.
    // 이 엣지를 provider-레벨 forwardRef 로 lazy 화해 순환을 끊는다.
    @Inject(forwardRef(() => SlackService))
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
    // 스윕이 이 PR 을 이미 리뷰·게시했는지 판정하는 원장.
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly agentRunRepository: AgentRunRepositoryPort,
  ) {
    const raw = this.configService.get<string>('SUBCONSCIOUS_PROPOSAL_TTL_MS');
    if (raw !== undefined) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.ttlMs = parsed;
      }
    }
  }

  // 카드를 만들 이유가 있는지 — 엔진이 예산을 소비하기 전에 호출한다.
  async shouldEmit({
    ownerUserId,
    decision,
  }: {
    ownerUserId: string;
    decision: GateDecision;
  }): Promise<boolean> {
    const agentType = decision.suggestedAgentType;
    if (agentType === undefined) {
      return false;
    }

    // 스윕(PR_REVIEW_SWEEP)이 이미 리뷰를 게시한 PR 은 카드를 만들지 않는다. 눌러도 같은
    // 리뷰를 한 번 더 돌릴 뿐이다. allowlist 가 아니라 "실제로 리뷰됐다"는 원장 기록을 근거로
    // 삼는다 — 카드 소스(assignee:@me)와 스윕 대상(author:owner)이 다른 집합이라, allowlist
    // 만 보고 생략하면 스윕이 조회하지 않는 PR(남이 작성해 나에게 할당 등)의 리뷰 경로가
    // 통째로 사라진다.
    const swept = await this.isAlreadySweptPullRequest(
      agentType,
      decision.changeKey,
    );
    if (swept) {
      this.logger.log(
        `changeKey="${decision.changeKey}" 는 PR 리뷰 스윕이 이미 게시함 — 제안 카드 생략`,
      );
      return false;
    }

    // 같은 대상에 아직 응답하지 않은 카드가 있으면 새로 만들지 않는다. PR 이 갱신될 때마다
    // 카드가 하나씩 늘어 만료 카드가 쌓이던 문제 (2026-08-03: #961 한 건에 카드 4장).
    // 만료된 카드는 눌러도 실행되지 않으므로 TTL 안쪽만 센다.
    const pending = await this.repository.hasPending(
      ownerUserId,
      decision.changeKey,
      new Date(Date.now() - this.ttlMs),
    );
    if (pending) {
      this.logger.log(
        `changeKey="${decision.changeKey}" 에 미응답 제안 카드가 이미 있음 — 중복 생성 생략`,
      );
      return false;
    }

    return true;
  }

  async emit({
    ownerUserId,
    change,
    decision,
  }: {
    ownerUserId: string;
    change: StateChange;
    decision: GateDecision;
  }): Promise<void> {
    const proposalText =
      decision.proposalText ?? `${change.kind} ${change.item.summary}`;

    const record = await this.repository.create({
      ownerUserId,
      sourceId: change.sourceId,
      changeKey: decision.changeKey,
      suggestedAgentType: decision.suggestedAgentType!,
      proposalText,
      contextJson: { change },
    });

    try {
      const { channelId, messageTs } =
        await this.slackService.postProposalMessage({
          target: ownerUserId,
          proposalText,
          proposalId: record.id,
        });
      await this.repository.attachSlackMessage(record.id, channelId, messageTs);
    } catch (error: unknown) {
      // Slack 발송 실패는 proposal 생성 자체를 롤백하지 않는다 — proposal 은 DB 에 남고,
      // Slack 알림만 누락된 상태. 운영 로그로만 남긴다.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `SubconsciousProposal id=${record.id} Slack 발송 실패 (proposal 유효): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async apply(
    proposalId: number,
    byUserId: string,
    now: Date = new Date(),
  ): Promise<string> {
    const record = await this.assertReadyToResolve(proposalId, byUserId, now);

    const moved = await this.repository.transitionFromPending(
      proposalId,
      'DISPATCHED',
      new Date(now),
    );
    if (!moved) {
      throw new SubconsciousProposalException(
        '이미 처리된 제안입니다.',
        DomainStatus.PRECONDITION_FAILED,
      );
    }

    const context = record.contextJson as { change?: StateChange };
    const changeSummary = context.change?.item?.summary ?? record.changeKey;
    const changeKey = context.change?.item?.key ?? record.changeKey;

    const agentType = record.suggestedAgentType as AgentType;
    const prReferenceHint = resolvePrReferenceHint(agentType, changeKey);

    const dispatchInput: DispatchInput = {
      source: 'SLACK_MESSAGE',
      slackUserId: byUserId,
      agentTypeHint: agentType,
      // PR 참조 워커는 사람용 요약(제목)이 아니라 key 에서 복원한 PR 참조를 받아야 한다.
      text: resolveDispatchText(agentType, changeKey, changeSummary),
      // 설명과 참조가 모두 필요한 워커(BE)에는 요약을 유지한 채 참조를 따로 동봉한다.
      ...(prReferenceHint !== null ? { prReferenceHint } : {}),
    };

    try {
      await this.router.dispatch(dispatchInput);
    } catch (error: unknown) {
      // dispatch 실패는 이미 DISPATCHED 전이된 상태라 status 를 롤백하지 않는다 (v1 정책).
      // 호출자(Slack handler)가 사용자에게 dispatch 시도는 했으나 실패했음을 안내할 수 있도록 re-throw.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `SubconsciousProposal id=${proposalId} dispatch 실패 (DISPATCHED 전이 완료, status 롤백 없음): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    return `✅ ${record.suggestedAgentType} 실행 요청 완료 — "${changeSummary}"`;
  }

  async dismiss(proposalId: number, byUserId: string): Promise<void> {
    const found = await this.repository.findById(proposalId);
    if (!found) {
      throw new SubconsciousProposalException(
        `Proposal ${proposalId} 를 찾을 수 없습니다.`,
        DomainStatus.NOT_FOUND,
      );
    }
    if (found.ownerUserId !== byUserId) {
      throw new SubconsciousProposalException(
        '다른 사용자의 proposal 을 무시할 수 없습니다.',
        DomainStatus.FORBIDDEN,
      );
    }
    if (found.status !== 'PENDING') {
      throw new SubconsciousProposalException(
        `Proposal 이 이미 ${found.status} 상태입니다.`,
        DomainStatus.PRECONDITION_FAILED,
      );
    }
    const moved = await this.repository.transitionFromPending(
      proposalId,
      'DISMISSED',
      new Date(),
    );
    if (!moved) {
      throw new SubconsciousProposalException(
        '이미 처리된 제안입니다.',
        DomainStatus.PRECONDITION_FAILED,
      );
    }
  }

  // 스윕이 이 PR 을 실제로 리뷰·게시했는지. 연습 모드(dryRun)로 끝났거나 실패한 리뷰는
  // 게시가 없었으므로 카드를 유지한다.
  private async isAlreadySweptPullRequest(
    agentType: AgentType,
    changeKey: string,
  ): Promise<boolean> {
    if (agentType !== AgentType.CODE_REVIEWER) {
      return false;
    }
    const prRef = extractPrReference(changeKey);
    if (prRef === null) {
      return false;
    }
    const latest = await this.agentRunRepository.findLatestSweepReview({
      prRef,
      sinceDays: SWEEP_REVIEW_LOOKBACK_DAYS,
    });
    return latest !== null && latest.status === 'SUCCEEDED' && !latest.dryRun;
  }

  private async assertReadyToResolve(
    proposalId: number,
    byUserId: string,
    now: Date,
  ): Promise<SubconsciousProposalRecord> {
    const found = await this.repository.findById(proposalId);
    if (!found) {
      throw new SubconsciousProposalException(
        `Proposal ${proposalId} 를 찾을 수 없습니다.`,
        DomainStatus.NOT_FOUND,
      );
    }
    if (found.ownerUserId !== byUserId) {
      throw new SubconsciousProposalException(
        '다른 사용자의 proposal 을 실행할 수 없습니다.',
        DomainStatus.FORBIDDEN,
      );
    }
    if (found.status !== 'PENDING') {
      throw new SubconsciousProposalException(
        `Proposal 이 이미 ${found.status} 상태입니다.`,
        DomainStatus.PRECONDITION_FAILED,
      );
    }
    const ageMs = now.getTime() - found.createdAt.getTime();
    if (ageMs > this.ttlMs) {
      throw new SubconsciousProposalException(
        'Proposal 이 만료되었습니다 (TTL 초과). 새 제안을 기다려주세요.',
        DomainStatus.PRECONDITION_FAILED,
      );
    }
    return found;
  }
}

export class SubconsciousProposalException extends DomainException {
  readonly errorCode = 'SUBCONSCIOUS_PROPOSAL_ERROR';
  readonly status: DomainStatus;

  constructor(message: string, domainStatus: DomainStatus) {
    super(message);
    this.status = domainStatus;
    this.name = SubconsciousProposalException.name;
  }
}

// NestJS DI injection token alias — SubconsciousModule 이 PROPOSAL_EMITTER 에 bind 할 때 사용.
export { PROPOSAL_EMITTER };
