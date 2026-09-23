import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../model-router/domain/model-router.type';
import { GateDecision, RedactedChange } from '../domain/subconscious.type';

const DEFAULT_MODEL = 'jev-1.13.0';
const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_PROMOTE_THRESHOLD = 0.98;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.95;
const API_URL = 'https://api.typesafe.ai/v1/systemone';

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

export interface JevEvaluation {
  readonly decisions: readonly GateDecision[];
  readonly confidentDecisions: readonly GateDecision[];
  readonly fallbackChanges: readonly RedactedChange[];
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

@Injectable()
export class JevSubconsciousGate {
  constructor(private readonly configService: ConfigService) {}

  async evaluate(changes: RedactedChange[]): Promise<JevEvaluation> {
    if (changes.length === 0) {
      return {
        decisions: [],
        confidentDecisions: [],
        fallbackChanges: [],
        model: this.model,
      };
    }

    const response = await this.request(changes);
    const answers = response.answers;
    if (!answers) {
      throw new Error('Jev response did not contain answers');
    }

    const decisions: GateDecision[] = [];
    const confidentDecisions: GateDecision[] = [];
    const fallbackChanges: RedactedChange[] = [];

    changes.forEach((change, index) => {
      const promote = answers[`promote_${index}`];
      const agent = answers[`agent_${index}`];
      const promoteProbability = promote?.noul;
      const agentConfidence = agent?.confidence;
      const suggestedAgentType = this.toAgentType(agent?.choice);

      if (
        typeof promoteProbability !== 'number' ||
        typeof agentConfidence !== 'number' ||
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
      model: response.model ?? this.model,
    };
  }

  private async request(changes: RedactedChange[]): Promise<JevResponse> {
    const apiKey = this.configService.get<string>('TYPESAFE_API_KEY')?.trim();
    if (!apiKey) {
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
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Jev API returned HTTP ${response.status}`);
      }
      return (await response.json()) as JevResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private toAgentType(value: string | undefined): AgentType | undefined {
    return (SUGGESTABLE_AGENTS as readonly string[]).includes(value ?? '')
      ? (value as AgentType)
      : undefined;
  }

  private get model(): string {
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
