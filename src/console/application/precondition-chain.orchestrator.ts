import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainException } from '../../common/exception/domain.exception';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  IDAERI_ROUTER_PORT,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { resolveChain } from '../domain/precondition-chain.map';
import { ConsoleEventBus } from './console-event-bus.service';

const MAX_CHAIN_DEPTH = 3;
const DEFAULT_IMPACT_RECENT_DAYS = 7;

export interface ConsoleChainInput {
  slackUserId: string;
  text?: string;
  agentTypeHint?: AgentType;
  commandId?: string;
}

interface ChainState {
  depth: number;
  visited: AgentType[];
  path: string[];
}

type ChainOutcome = { ok: true } | { ok: false; reason: string };

// 콘솔 리모컨 2A.2 — 역방향 선행 트리거 오케스트레이터(REMOTE_CONSOLE 국한).
// precondition 예외는 LLM 호출 전에 발생하므로 실패한 dispatch 는 codex 를 쓰지 않는다.
@Injectable()
export class PreconditionChainOrchestrator {
  private readonly logger = new Logger(PreconditionChainOrchestrator.name);

  constructor(
    @Inject(IDAERI_ROUTER_PORT)
    private readonly router: IdaeriRouterPort,
    private readonly consoleEvents: ConsoleEventBus,
    private readonly config: ConfigService,
  ) {}

  async run(input: ConsoleChainInput): Promise<void> {
    await this.runChain(input, {
      depth: 0,
      visited: [],
      path: [String(input.agentTypeHint ?? input.text ?? '(자연어)')],
    });
  }

  private async runChain(
    input: ConsoleChainInput,
    chain: ChainState,
  ): Promise<ChainOutcome> {
    try {
      const result = await this.router.dispatch({
        source: 'REMOTE_CONSOLE',
        slackUserId: input.slackUserId,
        text: input.text,
        agentTypeHint: input.agentTypeHint,
      });
      if (input.commandId && result.autoResolvedNotice) {
        this.consoleEvents.publish({
          type: 'command.info',
          commandId: input.commandId,
          message: result.autoResolvedNotice,
        });
      }
      return { ok: true };
    } catch (error: unknown) {
      if (!(error instanceof DomainException)) {
        const reason = error instanceof Error ? error.message : String(error);
        return this.reject(input, chain, reason);
      }
      const resolution = resolveChain(error.errorCode);
      if (!resolution || resolution.kind === 'UNRESOLVABLE') {
        return this.reject(input, chain, error.message);
      }
      if (chain.visited.includes(resolution.prereqWorker)) {
        return this.reject(
          input,
          chain,
          `순환 감지: ${resolution.prereqWorker} 재진입`,
        );
      }
      if (chain.depth + 1 > MAX_CHAIN_DEPTH) {
        return this.reject(input, chain, '자동 체이닝 깊이 초과');
      }
      if (input.commandId) {
        this.consoleEvents.publish({
          type: 'command.info',
          commandId: input.commandId,
          message: `${resolution.failedWorkerLabel} 실행에 필요한 ${resolution.prereqWorker} 선행이 없어 먼저 실행합니다.`,
        });
      }
      const prereqInput: ConsoleChainInput = {
        slackUserId: input.slackUserId,
        agentTypeHint: resolution.prereqWorker,
        text: resolution.needsRecentArg
          ? `--recent ${this.impactRecentDays()}d`
          : undefined,
        commandId: input.commandId,
      };
      const nextChain: ChainState = {
        depth: chain.depth + 1,
        visited: [...chain.visited, resolution.prereqWorker],
        path: [...chain.path, resolution.prereqWorker],
      };
      const prereqOutcome = await this.runChain(prereqInput, nextChain);
      if (!prereqOutcome.ok) {
        return prereqOutcome;
      }
      return this.runChain(input, nextChain);
    }
  }

  private reject(
    input: ConsoleChainInput,
    chain: ChainState,
    reason: string,
  ): ChainOutcome {
    const path = chain.path.join(' ← ');
    this.logger.warn(`콘솔 체이닝 중단 — ${path}: ${reason}`);
    if (input.commandId) {
      this.consoleEvents.publish({
        type: 'command.rejected',
        commandId: input.commandId,
        reason: `${path}: ${reason}`,
      });
    }
    return { ok: false, reason };
  }

  private impactRecentDays(): number {
    const raw = this.config.get<string>('CONSOLE_CHAIN_IMPACT_RECENT_DAYS');
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_IMPACT_RECENT_DAYS;
  }
}
