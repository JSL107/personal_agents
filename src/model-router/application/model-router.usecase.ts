import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ModelRouterException } from '../domain/model-router.exception';
import {
  AgentType,
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelRouterErrorCode } from '../domain/model-router-error-code.enum';
import {
  MODEL_PROVIDER_TOKENS,
  ModelProviderPort,
} from '../domain/port/model-provider.port';

// 기획서 §13 모델 라우팅 전략에 따른 에이전트 → 모델 매핑.
// 계획/설명/회고 계열은 ChatGPT, 코드 작업은 Claude 중심.
const AGENT_TO_PROVIDER: Record<AgentType, ModelProviderName> = {
  [AgentType.PM]: ModelProviderName.CHATGPT,
  [AgentType.BE]: ModelProviderName.CLAUDE,
  [AgentType.CODE_REVIEWER]: ModelProviderName.CLAUDE,
  [AgentType.WORK_REVIEWER]: ModelProviderName.CHATGPT,
};

@Injectable()
export class ModelRouterUsecase {
  constructor(
    @Inject(MODEL_PROVIDER_TOKENS[ModelProviderName.CHATGPT])
    private readonly chatgptProvider: ModelProviderPort,
    @Inject(MODEL_PROVIDER_TOKENS[ModelProviderName.CLAUDE])
    private readonly claudeProvider: ModelProviderPort,
    @Inject(MODEL_PROVIDER_TOKENS[ModelProviderName.GEMINI])
    private readonly geminiProvider: ModelProviderPort,
  ) {}

  async route({
    agentType,
    request,
  }: {
    agentType: AgentType;
    request: CompletionRequest;
  }): Promise<CompletionResponse> {
    const providerName = AGENT_TO_PROVIDER[agentType];
    if (!providerName) {
      throw new ModelRouterException({
        code: ModelRouterErrorCode.UNKNOWN_AGENT_TYPE,
        message: `라우팅 매핑이 없는 에이전트 타입입니다: ${agentType}`,
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const provider = this.resolveProvider(providerName);

    try {
      return await provider.complete(request);
    } catch (error: unknown) {
      throw new ModelRouterException({
        code: ModelRouterErrorCode.COMPLETION_FAILED,
        message: `모델 호출 실패 (${providerName})`,
        status: HttpStatus.BAD_GATEWAY,
        cause: error,
      });
    }
  }

  private resolveProvider(name: ModelProviderName): ModelProviderPort {
    switch (name) {
      case ModelProviderName.CHATGPT:
        return this.chatgptProvider;
      case ModelProviderName.CLAUDE:
        return this.claudeProvider;
      case ModelProviderName.GEMINI:
        return this.geminiProvider;
      default: {
        const exhaustive: never = name;
        throw new ModelRouterException({
          code: ModelRouterErrorCode.PROVIDER_NOT_AVAILABLE,
          message: `알 수 없는 모델 Provider: ${String(exhaustive)}`,
        });
      }
    }
  }
}
