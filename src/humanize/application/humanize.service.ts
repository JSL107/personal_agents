import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  PREFERENCE_PROFILE_PORT,
  PreferenceProfilePort,
} from '../../preference-profile/domain/port/preference-profile.port';
import { parseHumanizeOutput } from '../domain/humanize-output.parser';
import {
  HUMANIZE_CONCISE_RULES,
  HUMANIZE_SYSTEM_PROMPT,
} from '../domain/humanize-system.prompt';

export interface HumanizeOptions {
  /**
   * 분량이 필요한 산출물(블로그 본문·이력서 서술)이라 길이 예산을 걸지 않는다.
   *
   * 기본은 간결 모드다 — 윤문 결과의 대다수가 Slack 카드로 훑어 읽히기 때문이다.
   */
  longForm?: boolean;
}

// 자동 보고서 서술 필드 윤문(humanize). best-effort — 어떤 실패도 원본을 반환해 보고서를 막지 않는다.
@Injectable()
export class HumanizeService {
  private readonly logger = new Logger(HumanizeService.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
    @Optional()
    @Inject(PREFERENCE_PROFILE_PORT)
    private readonly preferenceProfile?: PreferenceProfilePort,
  ) {}

  isEnabled(): boolean {
    return (
      this.configService.get<string>('HUMANIZE_REPORTS_ENABLED') !== 'false'
    );
  }

  // fields 의 각 값을 윤문해 같은 키 맵으로 반환. 비활성/빈값/실패 시 입력을 그대로 반환.
  async humanize(
    fields: Record<string, string>,
    options?: HumanizeOptions,
  ): Promise<Record<string, string>> {
    if (!this.isEnabled()) {
      return fields;
    }
    const keys = Object.keys(fields).filter(
      (key) => fields[key]?.trim().length > 0,
    );
    if (keys.length === 0) {
      return fields;
    }

    const payload: Record<string, string> = {};
    for (const key of keys) {
      payload[key] = fields[key];
    }

    try {
      // 실행 원장에 남긴다. 윤문은 실패해도 원본을 그대로 내보내는 best-effort 경로라
      // (아래 catch), 원장이 없으면 "윤문이 며칠째 안 먹고 있다" 가 겉으로 드러나지 않는다.
      // execute 는 FAILED 로 마감한 뒤 같은 에러를 다시 던지고 아래 catch 가 기존처럼 받는다
      // — 바깥 동작은 그대로 두고 기록만 추가한다.
      const outcome = await this.agentRunService.execute<
        Record<string, string>
      >({
        agentType: AgentType.HUMANIZER,
        triggerType: TriggerType.REPORT_HUMANIZE,
        inputSnapshot: { fieldKeys: keys },
        run: async () => {
          const injection = this.preferenceProfile
            ? await this.preferenceProfile.getInjectionBlock('humanize')
            : '';
          const basePrompt = options?.longForm
            ? HUMANIZE_SYSTEM_PROMPT
            : `${HUMANIZE_SYSTEM_PROMPT}\n${HUMANIZE_CONCISE_RULES}`;
          const systemPrompt = injection
            ? `${basePrompt}\n\n${injection}`
            : basePrompt;
          const completion = await this.modelRouter.route({
            agentType: AgentType.HUMANIZER,
            request: {
              prompt: JSON.stringify(payload),
              systemPrompt,
            },
            // ChatGPT(codex) 전용 — 실패 시 Claude 로 fallback 하지 않는다. 윤문은 best-effort 라
            // codex 실패 시 Claude 로 새느니 catch 에서 원본을 그대로 반환한다(아래).
            noFallback: true,
          });
          const humanized = parseHumanizeOutput(completion.text, keys);
          return {
            result: { ...fields, ...humanized },
            modelUsed: completion.modelUsed,
            // 윤문 본문은 원장에 담지 않는다 — 보고서 전문이 그대로 복제된다.
            output: { humanizedKeys: Object.keys(humanized) },
          };
        },
      });
      return outcome.result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`윤문 실패 — 원본 유지: ${message}`);
      return fields;
    }
  }
}
