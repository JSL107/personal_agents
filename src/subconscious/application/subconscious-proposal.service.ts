import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { DomainException } from '../../common/exception/domain.exception';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  DispatchInput,
  IdaeriRouterPort,
  IDAERI_ROUTER_PORT,
} from '../../router/domain/idaeri-router.port';
import { SlackService } from '../../slack/slack.service';
import { GateDecision, StateChange } from '../domain/subconscious.type';
import { PROPOSAL_EMITTER } from '../domain/port/proposal-emitter.port';
import type { ProposalEmitter } from '../domain/port/proposal-emitter.port';
import {
  SUBCONSCIOUS_PROPOSAL_REPOSITORY,
  SubconsciousProposalRecord,
  SubconsciousProposalRepository,
} from '../domain/port/subconscious-proposal.repository.port';

const DEFAULT_TTL_MS = 3_600_000; // 1시간

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
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('SUBCONSCIOUS_PROPOSAL_TTL_MS');
    if (raw !== undefined) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.ttlMs = parsed;
      }
    }
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
      const { channelId, messageTs } = await this.slackService.postProposalMessage({
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

    await this.repository.markStatus(proposalId, 'DISPATCHED', new Date());

    const context = record.contextJson as { change?: StateChange };
    const changeSummary = context.change?.item?.summary ?? record.changeKey;

    const dispatchInput: DispatchInput = {
      source: 'SLACK_MESSAGE',
      slackUserId: byUserId,
      agentTypeHint: record.suggestedAgentType as AgentType,
      text: changeSummary,
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
    await this.repository.markStatus(proposalId, 'DISMISSED', new Date());
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
