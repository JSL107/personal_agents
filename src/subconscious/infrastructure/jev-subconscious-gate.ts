import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { GateDecision, RedactedChange } from '../domain/subconscious.type';

const DEFAULT_MODEL = 'jev-1.13.0';
const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_PROMOTE_THRESHOLD = 0.98;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.95;
const DEFAULT_API_URL = 'https://api.typesafe.ai/v1/systemone';
// 로컬 호환 서버(Kev 등)는 키 없이 받는다. 외부 주소에는 키 없이 보내지 않는다.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const SUGGESTABLE_AGENTS = [
  AgentType.CODE_REVIEWER,
  AgentType.PM,
  AgentType.WORK_REVIEWER,
] as const;

interface JevQuestion {
  readonly type: 'noul' | 'choice';
  readonly instructions: string;
  readonly criteria?: Record<string, string>;
}

interface JevAnswer {
  readonly type?: string;
  readonly noul?: number;
  readonly choice?: string;
  readonly confidence?: number;
}

interface JevResponse {
  readonly model?: string;
  readonly answers?: Record<string, JevAnswer>;
}

// 변경마다 한 개 — 응답이 깨진 변경도 null 로 남겨 shadow 원장이 빠짐없이 쌓이게 한다.
// agentChoice 는 SUGGESTABLE_AGENTS 필터 전의 원값(NONE 포함)이다.
export interface JevChangeScore {
  readonly changeKey: string;
  readonly promoteProbability: number | null;
  readonly agentChoice: string | null;
  readonly agentConfidence: number | null;
}

export interface JevEvaluation {
  readonly decisions: readonly GateDecision[];
  readonly confidentDecisions: readonly GateDecision[];
  readonly fallbackChanges: readonly RedactedChange[];
  readonly scores: readonly JevChangeScore[];
  readonly model: string;
}

const readPositiveNumber = (
  configService: ConfigService,
  key: string,
  fallback: number,
): number => {
  const raw = configService.get<string>(key)?.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const isLocalUrl = (url: string): boolean => {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

@Injectable()
export class JevSubconsciousGate {
  constructor(
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async evaluate(changes: RedactedChange[]): Promise<JevEvaluation> {
    if (changes.length === 0) {
      return {
        decisions: [],
        confidentDecisions: [],
        fallbackChanges: [],
        scores: [],
        model: this.model,
      };
    }

    const outcome = await this.agentRunService.execute<JevEvaluation>({
      agentType: AgentType.SUBCONSCIOUS_GATE,
      triggerType: TriggerType.SUBCONSCIOUS_TICK,
      inputSnapshot: {
        changeCount: changes.length,
        sourceIds: [...new Set(changes.map((change) => change.sourceId))],
        gate: 'jev',
        model: this.model,
      },
      run: async () => {
        const evaluation = await this.evaluateWithJev(changes);
        return {
          result: evaluation,
          modelUsed: evaluation.model,
          output: {
            gate: 'jev',
            decisions: evaluation.decisions,
            promotedCount: evaluation.confidentDecisions.length,
            fallbackCount: evaluation.fallbackChanges.length,
          },
        };
      },
    });
    return outcome.result;
  }

  private async evaluateWithJev(
    changes: RedactedChange[],
  ): Promise<JevEvaluation> {
    const response = this.parseResponse(await this.request(changes));
    const answers = response.answers;

    const decisions: GateDecision[] = [];
    const confidentDecisions: GateDecision[] = [];
    const fallbackChanges: RedactedChange[] = [];
    const scores: JevChangeScore[] = [];

    changes.forEach((change, index) => {
      const promote = answers[`promote_${index}`];
      const agent = answers[`agent_${index}`];
      const promoteProbability = promote?.noul;
      const agentConfidence = agent?.confidence;
      const suggestedAgentType = this.toAgentType(agent?.choice);
      scores.push({
        changeKey: change.key,
        promoteProbability:
          promote?.type === 'noul' && isProbability(promoteProbability)
            ? promoteProbability
            : null,
        agentChoice:
          agent?.type === 'choice' && typeof agent.choice === 'string'
            ? agent.choice
            : null,
        agentConfidence:
          agent?.type === 'choice' && isProbability(agentConfidence)
            ? agentConfidence
            : null,
      });

      if (
        promote?.type !== 'noul' ||
        !isProbability(promoteProbability) ||
        agent?.type !== 'choice' ||
        !isProbability(agentConfidence) ||
        suggestedAgentType === undefined
      ) {
        fallbackChanges.push(change);
        return;
      }

      const decision: GateDecision = {
        changeKey: change.key,
        promote: promoteProbability >= 0.5,
        reason: `Jev 1차 판단 (promote=${promoteProbability.toFixed(3)}, confidence=${agentConfidence.toFixed(3)})`,
        suggestedAgentType,
      };
      decisions.push(decision);

      if (
        promoteProbability >= this.promoteThreshold &&
        agentConfidence >= this.confidenceThreshold
      ) {
        confidentDecisions.push({ ...decision, promote: true });
        return;
      }

      fallbackChanges.push(change);
    });

    return {
      decisions,
      confidentDecisions,
      fallbackChanges,
      scores,
      model: response.model ?? this.model,
    };
  }

  private async request(changes: RedactedChange[]): Promise<unknown> {
    const apiUrl = this.apiUrl;
    const local = isLocalUrl(apiUrl);
    // 원격에는 https 로만 키를 보낸다. 로컬 호환 서버(Kev)에는 TypeSafe 키를 넘길 이유가 없다.
    if (!local && !apiUrl.startsWith('https://')) {
      throw new Error(
        'SUBCONSCIOUS_JEV_API_URL must use https for non-local hosts',
      );
    }
    const apiKey = local
      ? undefined
      : this.configService.get<string>('TYPESAFE_API_KEY')?.trim();
    if (!apiKey && !local) {
      throw new Error('TYPESAFE_API_KEY is not configured');
    }

    const state = changes.map((change, index) => ({
      index,
      changeKey: change.key,
      source: change.sourceId,
      kind: change.kind,
      summary: change.summary,
    }));
    const questions: Record<string, JevQuestion> = {};
    changes.forEach((_, index) => {
      questions[`promote_${index}`] = {
        type: 'noul',
        instructions: `Does change ${index} have enough action value to propose to the owner?`,
        criteria: {
          true: 'It is worth interrupting the owner with a Slack proposal.',
          false: 'It is routine noise or does not justify a proposal.',
        },
      };
      questions[`agent_${index}`] = {
        type: 'choice',
        instructions: `Which agent should handle change ${index}?`,
        criteria: {
          [AgentType.CODE_REVIEWER]: 'A pull request or code review task.',
          [AgentType.PM]: 'A planning or daily-plan task.',
          [AgentType.WORK_REVIEWER]: 'A work-log or progress-review task.',
          NONE: 'No supported agent is appropriate.',
        },
      };
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: apiKey
          ? {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Jev API returned HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(value: unknown): Required<JevResponse> {
    if (!isRecord(value)) {
      throw new Error('Jev response was not an object');
    }
    if (value.model !== this.model) {
      throw new Error('Jev response model did not match request');
    }
    if (!isRecord(value.answers)) {
      throw new Error('Jev response did not contain answers');
    }
    return {
      model: value.model,
      answers: value.answers as Record<string, JevAnswer>,
    };
  }

  private toAgentType(value: string | undefined): AgentType | undefined {
    return (SUGGESTABLE_AGENTS as readonly string[]).includes(value ?? '')
      ? (value as AgentType)
      : undefined;
  }

  private get apiUrl(): string {
    return (
      this.configService.get<string>('SUBCONSCIOUS_JEV_API_URL')?.trim() ||
      DEFAULT_API_URL
    );
  }

  // shadow 원장이 호출 실패 회차에도 어떤 모델을 겨냥했는지 남길 수 있게 공개한다.
  get model(): string {
    return (
      this.configService.get<string>('SUBCONSCIOUS_JEV_MODEL')?.trim() ||
      DEFAULT_MODEL
    );
  }

  private get timeoutMs(): number {
    return readPositiveNumber(
      this.configService,
      'SUBCONSCIOUS_JEV_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    );
  }

  private get promoteThreshold(): number {
    return readPositiveNumber(
      this.configService,
      'SUBCONSCIOUS_JEV_PROMOTE_THRESHOLD',
      DEFAULT_PROMOTE_THRESHOLD,
    );
  }

  private get confidenceThreshold(): number {
    return readPositiveNumber(
      this.configService,
      'SUBCONSCIOUS_JEV_CONFIDENCE_THRESHOLD',
      DEFAULT_CONFIDENCE_THRESHOLD,
    );
  }
}
