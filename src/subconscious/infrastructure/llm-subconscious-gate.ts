import { Inject, Injectable, Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { parseGateResponse } from '../application/parse-gate-response';
import { SubconsciousGate } from '../domain/port/subconscious-gate.port';
import { GateDecision, RedactedChange } from '../domain/subconscious.type';

const SYSTEM_PROMPT = [
  '당신은 이대리의 proactive 게이트다. 감지된 상태 변화 목록을 받아,',
  'owner 에게 Slack 으로 "이거 할까요?" 제안을 보낼 가치가 있는 것만 promote 한다.',
  '대부분의 변화는 노이즈다 — 확실히 행동 가치가 있을 때만 promote=true.',
  'suggestedAgentType 은 다음 중 하나: CODE_REVIEWER, BE, PM, WORK_REVIEWER.',
  '출력은 JSON 배열만: [{changeKey, promote, reason, suggestedAgentType?, proposalText?}]',
].join('\n');

@Injectable()
export class LlmSubconsciousGate implements SubconsciousGate {
  private readonly logger = new Logger(LlmSubconsciousGate.name);

  constructor(
    @Inject(ModelRouterUsecase)
    private readonly modelRouter: ModelRouterUsecase,
  ) {}

  async judge(changes: RedactedChange[]): Promise<GateDecision[]> {
    if (changes.length === 0) {
      return [];
    }
    const validKeys = new Set(changes.map((change) => change.key));
    const userPrompt = JSON.stringify(
      changes.map((change) => ({
        changeKey: change.key,
        source: change.sourceId,
        kind: change.kind,
        summary: change.summary,
      })),
    );
    try {
      const response = await this.modelRouter.route({
        agentType: AgentType.SUBCONSCIOUS_GATE,
        request: { prompt: userPrompt, systemPrompt: SYSTEM_PROMPT },
      });
      return parseGateResponse(response.text, validKeys);
    } catch (error) {
      // fail-closed(제안 0건)는 그대로 두되, 조용히 삼키지는 않는다.
      // 게이트가 죽으면 제안이 0건이 되는데 로그가 없으면 "노이즈가 없어서 0건"인지
      // "고장나서 0건"인지 구분할 수 없다 — 침묵하는 자동화가 가장 늦게 발견된다.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `잠재의식 게이트 판정 실패 — 변화 ${changes.length}건을 제안 0건으로 처리: ${reason}`,
      );
      return [];
    }
  }
}
