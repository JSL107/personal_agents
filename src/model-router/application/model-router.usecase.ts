import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  CLAUDE_AUTH_ALERT_PORT,
  ClaudeAuthAlertPort,
} from '../../notification/domain/port/claude-auth-alert.port';
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
import { ClaudeAuthSuspectException } from '../infrastructure/claude-cli.provider';

// 기획서 §13 모델 라우팅 전략에 따른 에이전트 → 모델 매핑.
// 계획/설명/회고 계열은 ChatGPT, 코드 작업은 Claude 중심.
const AGENT_TO_PROVIDER: Record<AgentType, ModelProviderName> = {
  [AgentType.PM]: ModelProviderName.CHATGPT,
  [AgentType.BE]: ModelProviderName.CLAUDE,
  [AgentType.CODE_REVIEWER]: ModelProviderName.CLAUDE,
  [AgentType.WORK_REVIEWER]: ModelProviderName.CHATGPT,
  [AgentType.IMPACT_REPORTER]: ModelProviderName.CHATGPT,
  [AgentType.PO_SHADOW]: ModelProviderName.CHATGPT,
  [AgentType.BE_SCHEMA]: ModelProviderName.CLAUDE,
  [AgentType.BE_TEST]: ModelProviderName.CLAUDE,
  [AgentType.BE_SRE]: ModelProviderName.CLAUDE,
  [AgentType.BE_FIX]: ModelProviderName.CLAUDE,
  // CTO — PM 의 assignableTaskIds 를 BE worker 5종으로 분류. 코드 도메인 결정 → Claude.
  [AgentType.CTO]: ModelProviderName.CLAUDE,
  // PO_EVAL — 3 sub-agent output 의 구조적 합성 + careerLog 생성. Claude 강점 (구조화 JSON).
  [AgentType.PO_EVAL]: ModelProviderName.CLAUDE,
  // CEO — PO_EVAL + PM/CTO 합성 → 메타 review. PO_EVAL 과 동일 구조 → Claude.
  [AgentType.CEO]: ModelProviderName.CLAUDE,
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
    // NotificationModule 미연결 (테스트 / 부분 부팅 등) 환경 대비 — undefined 시 알람 skip.
    @Optional()
    @Inject(CLAUDE_AUTH_ALERT_PORT)
    private readonly claudeAuthAlerter?: ClaudeAuthAlertPort,
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

      // claude CLI 인증 만료 / 쿼터 소진 의심 — 본 fallback 흐름과 별개로 owner 알람 발사.
      // (await 하지 않고 fire-and-forget — 알람 자체 실패가 fallback 흐름을 막지 않게.)
      this.maybeNotifyClaudeAuthSuspect(primaryError);

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

  // primary 실패가 ClaudeAuthSuspectException 일 때만 alerter 호출 — alerter 내부에서 30분 dedupe.
  // 알람 자체 실패는 모델 호출 자체에 영향 주지 않게 catch 안에서 stdout 만 남긴다.
  private maybeNotifyClaudeAuthSuspect(error: unknown): void {
    if (!(error instanceof ClaudeAuthSuspectException)) {
      return;
    }
    if (!this.claudeAuthAlerter) {
      return;
    }
    void this.claudeAuthAlerter
      .notifyAuthSuspect({ exitMessage: error.message })
      .catch((alertError: unknown) => {
        this.logger.warn(
          `claude 인증 의심 알람 발사 실패: ${alertError instanceof Error ? alertError.message : String(alertError)}`,
        );
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
