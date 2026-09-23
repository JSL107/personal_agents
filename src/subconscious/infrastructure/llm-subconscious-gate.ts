import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { parseGateResponse } from '../application/parse-gate-response';
import { SubconsciousGate } from '../domain/port/subconscious-gate.port';
import { GateDecision, RedactedChange } from '../domain/subconscious.type';

/**
 * 게이트가 제안할 수 있는 워커. **문자열이 아니라 `AgentType` 을 참조한다** — 예전에는
 * 프롬프트에 이름을 직접 적어 두었고, `BE` 가 삭제된(#479) 뒤에도 선택지에 남아 모델에게
 * 없는 워커를 권했다. 파서가 걸러 조용히 버렸으므로 넷 중 하나가 무효인 채로 지나갔다.
 * enum 을 참조하면 워커가 사라질 때 컴파일이 깨져 여기도 함께 고치게 된다.
 */
const SUGGESTABLE_AGENTS: readonly AgentType[] = [
  AgentType.CODE_REVIEWER,
  AgentType.PM,
  AgentType.WORK_REVIEWER,
];

const SYSTEM_PROMPT = [
  '당신은 이대리의 proactive 게이트다. 감지된 상태 변화 목록을 받아,',
  'owner 에게 Slack 으로 "이거 할까요?" 제안을 보낼 가치가 있는 것만 promote 한다.',
  '대부분의 변화는 노이즈다 — 확실히 행동 가치가 있을 때만 promote=true.',
  `suggestedAgentType 은 다음 중 하나: ${SUGGESTABLE_AGENTS.join(', ')}.`,
  '출력은 JSON 배열만: [{changeKey, promote, reason, suggestedAgentType?, proposalText?}]',
].join('\n');

@Injectable()
export class LlmSubconsciousGate implements SubconsciousGate {
  private readonly logger = new Logger(LlmSubconsciousGate.name);

  constructor(
    @Inject(ModelRouterUsecase)
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
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
      // 실행 원장에 남긴다. 이 게이트는 실패해도 제안 0건으로 조용히 넘어가므로(아래 catch),
      // 원장이 없으면 "노이즈가 없어서 0건" 과 "게이트가 죽어서 0건" 이 겉으로 똑같다.
      // execute 는 FAILED 로 마감한 뒤 같은 에러를 다시 던지고, 아래 catch 가 기존처럼 받는다
      // — 바깥 동작(fail-closed)은 그대로 두고 기록만 추가하는 구조다.
      const outcome = await this.agentRunService.execute<GateDecision[]>({
        agentType: AgentType.SUBCONSCIOUS_GATE,
        triggerType: TriggerType.SUBCONSCIOUS_TICK,
        inputSnapshot: {
          changeCount: changes.length,
          sourceIds: [...new Set(changes.map((change) => change.sourceId))],
        },
        run: async () => {
          const response = await this.modelRouter.route({
            agentType: AgentType.SUBCONSCIOUS_GATE,
            request: { prompt: userPrompt, systemPrompt: SYSTEM_PROMPT },
          });
          const parsed = parseGateResponse(response.text, validKeys);
          const decisions = parsed ?? [];
          // **입력 변화마다 판정이 하나씩 나와야 한다.** 승격하지 않기로 한 변화는 빠지는 게
          // 아니라 `promote: false` 로 남는다(`SYSTEM_PROMPT`). 그래서 판정 수가 입력 수에
          // 미달하면 그만큼이 조용히 유실된 것이고, 아래 catch 와 같은 무게로 남긴다.
          //
          // 실측(`agent_run`): 정상 회차 569 건은 **전건** 판정 수 = 입력 수였고 부분 판정은
          // 0 건이다. 미달을 정상으로 볼 근거가 없다.
          //
          // 조건을 길이로 잡으면 세 경우가 한 번에 걸린다 — 응답을 못 읽음(`null`),
          // 모델이 빈 배열을 반환, `validKeys` 밖 key 라 전량·일부가 걸러짐. 셋 다 "판정이
          // 온전하지 않다" 는 같은 사실이고, 원인만 문구로 가른다. `changes.length > 0` 은
          // 이 메서드 진입부에서 보장된다.
          //
          // 모델을 함께 적는다: 2026-09-17~19 유실 86 건은 provider 축으로 깨끗이 갈렸다
          // (claude 폴백 86/86 실패 · codex 0/86).
          if (decisions.length < changes.length) {
            const reason =
              parsed === null
                ? '응답을 JSON 배열로 읽지 못함'
                : `변화 ${changes.length}건 중 ${decisions.length}건만 판정됨`;
            this.logger.error(
              `잠재의식 게이트 판정 누락 — ${reason}, 나머지 ${changes.length - decisions.length}건을 제안 0건으로 처리 (model=${response.modelUsed})`,
            );
          }
          return {
            result: decisions,
            modelUsed: response.modelUsed,
            output: {
              promotedCount: decisions.filter((decision) => decision.promote)
                .length,
              decisions,
            },
          };
        },
      });
      return outcome.result;
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
