import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
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
  [AgentType.IMPACT_REPORTER]: ModelProviderName.CHATGPT,
  [AgentType.PO_SHADOW]: ModelProviderName.CHATGPT,
  [AgentType.PO_EXPAND]: ModelProviderName.CHATGPT,
  [AgentType.BE_SCHEMA]: ModelProviderName.CLAUDE,
  [AgentType.BE_TEST]: ModelProviderName.CLAUDE,
};

// 1차(primary) 실패 시 자동 재시도할 fallback provider.
// Gemini 가 무료 tier + Google Pro 구독이라 Codex/Claude 쿼터 소진/capacity 시 효과적인 backup.
const FALLBACK_PROVIDER = ModelProviderName.GEMINI;

@Injectable()
export class ModelRouterUsecase {
  private readonly logger = new Logger(ModelRouterUsecase.name);

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
    const primaryName = AGENT_TO_PROVIDER[agentType];
    if (!primaryName) {
      throw new ModelRouterException({
        code: ModelRouterErrorCode.UNKNOWN_AGENT_TYPE,
        message: `라우팅 매핑이 없는 에이전트 타입입니다: ${agentType}`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const primary = this.resolveProvider(primaryName);

    try {
      return await primary.complete(request);
    } catch (primaryError: unknown) {
      const primaryMessage =
        primaryError instanceof Error
          ? primaryError.message
          : String(primaryError);

      // 1차가 이미 fallback 모델이면 재시도 의미 없음 — 그대로 전파.
      if (primaryName === FALLBACK_PROVIDER) {
        throw this.wrapCompletionFailed({
          attempted: [primaryName],
          lastError: primaryError,
        });
      }

      this.logger.warn(
        `primary provider(${primaryName}) 실패, fallback(${FALLBACK_PROVIDER}) 으로 재시도: ${primaryMessage}`,
      );

      const fallback = this.resolveProvider(FALLBACK_PROVIDER);
      try {
        return await fallback.complete(request);
      } catch (fallbackError: unknown) {
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        this.logger.error(
          `fallback provider(${FALLBACK_PROVIDER}) 도 실패: ${fallbackMessage}`,
        );
        throw this.wrapCompletionFailed({
          attempted: [primaryName, FALLBACK_PROVIDER],
          lastError: fallbackError,
          primaryError,
        });
      }
    }
  }

  private wrapCompletionFailed({
    attempted,
    lastError,
    primaryError,
  }: {
    attempted: ModelProviderName[];
    lastError: unknown;
    primaryError?: unknown;
  }): ModelRouterException {
    const summary =
      attempted.length === 1
        ? `모델 호출 실패 (${attempted[0]})`
        : `모델 호출 실패 — primary ${attempted[0]} → fallback ${attempted[1]} 모두 실패`;
    return new ModelRouterException({
      code: ModelRouterErrorCode.COMPLETION_FAILED,
      message: summary,
      status: DomainStatus.BAD_GATEWAY,
      cause: primaryError ? { primaryError, lastError } : lastError,
    });
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
