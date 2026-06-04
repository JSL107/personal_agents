import { Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { BeDiffGeneratorException } from '../domain/be-diff-generator.exception';
import {
  BeDiffGenerationInput,
  BeDiffGenerationResult,
} from '../domain/be-diff-generator.type';
import { BeDiffGeneratorErrorCode } from '../domain/be-diff-generator-error-code.enum';
import { parseBeDiffGeneration } from '../domain/prompt/be-diff-generator.parser';
import { BE_DIFF_GENERATOR_SYSTEM_PROMPT } from '../domain/prompt/be-diff-generator-system.prompt';

// 입력 plan 본문 cap — prompt 폭주 방지. 평균 BackendPlan 이 1~2KB 라 8KB 면 충분.
const PLAN_TEXT_MAX_BYTES = 8_000;

// AgentRunService 통하지 않음 — Phase 2a-2 의 첫 step 은 BeSandboxApplier 가 한 turn 안에서 호출.
// AgentRun row 별도 만들지 않고 PreviewAction 의 일부 처리로 본다 (chain 추적은 Phase 2c 에서 검토).
//
// ModelRouterUsecase 경유 — AgentType.BE 매핑 (CLAUDE primary) + Claude 침묵 실패 시 ChatGPT 자동
// fallback. 이전엔 Claude provider 직접 주입이라 Claude 만 실패하면 PR 흐름 전체가 막혔음.
@Injectable()
export class GenerateBeDiffUsecase {
  private readonly logger = new Logger(GenerateBeDiffUsecase.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async execute(input: BeDiffGenerationInput): Promise<BeDiffGenerationResult> {
    const trimmed = input.planText.trim();
    if (trimmed.length === 0) {
      throw new BeDiffGeneratorException({
        code: BeDiffGeneratorErrorCode.EMPTY_PLAN,
        message: 'plan 텍스트가 비어 있어 diff 생성을 진행할 수 없습니다.',
        status: DomainStatus.BAD_REQUEST,
      });
    }
    const cappedPlan = truncateUtf8(trimmed, PLAN_TEXT_MAX_BYTES);

    const prompt = buildPrompt({
      planText: cappedPlan,
      repoLabel: input.repoLabel,
      baseBranch: input.baseBranch,
    });

    const response = await this.modelRouter.route({
      agentType: AgentType.BE,
      request: { prompt, systemPrompt: BE_DIFF_GENERATOR_SYSTEM_PROMPT },
    });
    this.logger.log(
      `BeDiff generated — repo=${input.repoLabel} base=${input.baseBranch} planBytes=${trimmed.length} modelUsed=${response.modelUsed}`,
    );
    return parseBeDiffGeneration(response.text);
  }
}

const buildPrompt = ({
  planText,
  repoLabel,
  baseBranch,
}: {
  planText: string;
  repoLabel: string;
  baseBranch: string;
}): string =>
  [
    `[Repo]`,
    repoLabel,
    '',
    `[Base branch]`,
    baseBranch,
    '',
    `[Plan]`,
    planText,
    '',
    `위 plan 을 위 규칙대로 JSON 한 줄 (diff + reasoning + changedFiles) 로 출력하세요.`,
  ].join('\n');

const truncateUtf8 = (text: string, maxBytes: number): string => {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return text;
  }
  const sliced = buffer
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/�$/, '');
  return `${sliced}\n... (생략됨 — plan cap ${maxBytes} bytes)`;
};
