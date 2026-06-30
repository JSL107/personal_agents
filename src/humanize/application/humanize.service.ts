import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { parseHumanizeOutput } from '../domain/humanize-output.parser';
import { HUMANIZE_SYSTEM_PROMPT } from '../domain/humanize-system.prompt';

// 자동 보고서 서술 필드 윤문(humanize). best-effort — 어떤 실패도 원본을 반환해 보고서를 막지 않는다.
@Injectable()
export class HumanizeService {
  private readonly logger = new Logger(HumanizeService.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly configService: ConfigService,
  ) {}

  isEnabled(): boolean {
    return (
      this.configService.get<string>('HUMANIZE_REPORTS_ENABLED') !== 'false'
    );
  }

  // fields 의 각 값을 윤문해 같은 키 맵으로 반환. 비활성/빈값/실패 시 입력을 그대로 반환.
  async humanize(
    fields: Record<string, string>,
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
      const completion = await this.modelRouter.route({
        agentType: AgentType.HUMANIZER,
        request: {
          prompt: JSON.stringify(payload),
          systemPrompt: HUMANIZE_SYSTEM_PROMPT,
        },
        // ChatGPT(codex) 전용 — 실패 시 Claude 로 fallback 하지 않는다. 윤문은 best-effort 라
        // codex 실패 시 Claude 로 새느니 catch 에서 원본을 그대로 반환한다(아래).
        noFallback: true,
      });
      const humanized = parseHumanizeOutput(completion.text, keys);
      return { ...fields, ...humanized };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`윤문 실패 — 원본 유지: ${message}`);
      return fields;
    }
  }
}
