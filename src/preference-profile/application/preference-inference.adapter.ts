import { Injectable, Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { PreferenceDiff, PreferenceProfile } from '../domain/preference-profile.type';
import { PreferenceSignal } from '../domain/preference-signal.type';

export interface InferenceResult {
  diff: PreferenceDiff;
  rationale: string;
}

const SYSTEM_PROMPT = [
  '너는 한 사용자의 협업 에이전트 선호를 학습하는 분석기다.',
  '현재 프로필과 최근 신호(승인/거부 이력, 교정 발화, 반응)를 보고,',
  '프로필에 반영할 "작은" 변경만 JSON diff 로 제안하라. 과도한 추론 금지.',
  '출력은 오직 JSON: {"diff": {...}, "rationale": "..."} 형식.',
  'diff 키: tone/priorities/doNot 은 {add?:string[],remove?:string[]},',
  'verbosity 는 {briefing?,plan?,humanize?: "terse"|"balanced"|"detailed"},',
  'routingHints 는 {add?:[{phrase,intent}],remove?:string[]}.',
  '확실한 신호가 없으면 빈 diff {"diff":{},"rationale":"변경 없음"} 를 반환.',
].join('\n');

// LLM 원응답에서 {diff, rationale} 파싱. 실패 시 null(fail-closed).
export const parsePreferenceDiff = (raw: string): InferenceResult | null => {
  try {
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null || !parsed.diff) {
      return null;
    }
    return {
      diff: parsed.diff as PreferenceDiff,
      rationale:
        typeof parsed.rationale === 'string' ? parsed.rationale : '',
    };
  } catch {
    return null;
  }
};

@Injectable()
export class PreferenceInferenceAdapter {
  private readonly logger = new Logger(PreferenceInferenceAdapter.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async infer(
    current: PreferenceProfile,
    signals: PreferenceSignal[],
  ): Promise<InferenceResult | null> {
    if (signals.length === 0) {
      return null;
    }
    const prompt = JSON.stringify({ current, signals });
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.PREFERENCE_LEARNING,
        request: { prompt, systemPrompt: SYSTEM_PROMPT },
      });
      return parsePreferenceDiff(completion.text);
    } catch (error) {
      this.logger.warn(
        `선호 추론 실패(skip): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
