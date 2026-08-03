import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  FindingResolutionJudgment,
  JudgeFindingResolutionInput,
  ResolutionVerdict,
} from '../domain/finding-resolution.type';
import {
  buildFindingResolutionPrompt,
  FINDING_RESOLUTION_SYSTEM_PROMPT,
} from '../domain/prompt/finding-resolution.prompt';
import { parseVerdictBatch } from '../domain/verdict-batch.parser';
import { extractCodexQuota } from './extract-codex-quota';

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  'FIXED',
  'NOT_FIXED',
  'UNCLEAR',
]);

// 답변 판정과 같은 REVIEW_REPLY_JUDGE 로 라우팅한다. AgentType 은 모델 선택 키일 뿐이라
// 같은 모델을 쓸 거면 새로 만들 이유가 없다(신규 AgentType 은 AGENT_TO_PROVIDER·
// agent-registry·docs:check 동기화를 달고 온다). 판정 품질은 전용 프롬프트로 가른다.
@Injectable()
export class JudgeFindingResolutionUsecase {
  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async execute({
    items,
  }: JudgeFindingResolutionInput): Promise<FindingResolutionJudgment[]> {
    if (items.length === 0) {
      return [];
    }
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.REVIEW_REPLY_JUDGE,
        request: {
          prompt: buildFindingResolutionPrompt(items),
          systemPrompt: FINDING_RESOLUTION_SYSTEM_PROMPT,
        },
      });
      return parseVerdictBatch<ResolutionVerdict>({
        text: completion.text,
        ids: items.map((item) => item.id),
        validVerdicts: VALID_VERDICTS,
        fallback: 'UNCLEAR',
      });
    } catch (error: unknown) {
      const quota = extractCodexQuota(error);
      if (quota) {
        throw quota;
      }
      throw error;
    }
  }
}
