import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
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
import { CodexQuotaExceededException } from '../infrastructure/codex-cli.provider';

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
  // ISSUE_LABELER — issue title/body 를 repo label vocab 안에서 분류. JSON 한 줄 출력 → Claude.
  [AgentType.ISSUE_LABELER]: ModelProviderName.CLAUDE,
  // VACATION — 슬래시 경로는 결정론 계산이라 route() 미호출. 자연어 파라미터 추출 시에만 사용 → ChatGPT.
  [AgentType.VACATION]: ModelProviderName.CHATGPT,
  // BLOG — Hermes CLI(`hermes -z`)를 직접 spawn 하는 외부 에이전트라 route() 를 거치지 않는다.
  // 이 엔트리는 Record<AgentType,...> exhaustive 타입 충족용 sentinel 일 뿐 실제 호출되지 않음.
  [AgentType.BLOG]: ModelProviderName.CLAUDE,
  // CAREER_MATE — merged PR → 역량 프로필 구조 합성. 구조화 JSON 강점 → Claude.
  [AgentType.CAREER_MATE]: ModelProviderName.CLAUDE,
  // JOB_APPLICATION — CRUD 는 결정론. 자연어 ADD/UPDATE 파라미터 추출 경량 → VACATION 동일 ChatGPT.
  [AgentType.JOB_APPLICATION]: ModelProviderName.CHATGPT,
  // SUBCONSCIOUS_GATE — 내부 proactive 게이트. redacted 변화 요약을 promote/drop 분류. 경량 → ChatGPT.
  [AgentType.SUBCONSCIOUS_GATE]: ModelProviderName.CHATGPT,
  // CONTRADICTION_JUDGE — L4 knowledge-lint 모순 판정. 경량 분류 + claude -p 회피 → ChatGPT.
  [AgentType.CONTRADICTION_JUDGE]: ModelProviderName.CHATGPT,
  // HUMANIZER — 보고서/프로필 서술 필드 윤문. 경량 한국어 문체 → ChatGPT(codex) 전용.
  // HumanizeService 가 noFallback:true 로 호출 — ChatGPT 실패 시 Claude 로 새지 않고 윤문을 건너뛴다(원본 유지).
  [AgentType.HUMANIZER]: ModelProviderName.CHATGPT,
  // docs-sync-audit Layer 2 — 문서 의미 드리프트 optimizer/evaluator. 경량 → ChatGPT.
  [AgentType.DOCS_AUDIT_OPTIMIZER]: ModelProviderName.CHATGPT,
  [AgentType.DOCS_AUDIT_EVALUATOR]: ModelProviderName.CHATGPT,
  // PREFERENCE_LEARNING — 신호 배치 → 선호 프로필 diff 추론. 경량 판정 → ChatGPT.
  [AgentType.PREFERENCE_LEARNING]: ModelProviderName.CHATGPT,
};

// 1차(primary) 실패 시 자동 재시도할 반대편 provider — 양방향(2026-06-10).
// CLAUDE 실패 → CHATGPT (codex) 로, CHATGPT 실패(codex 쿼터 소진 등) → CLAUDE 로 fallback.
// fallback 은 1회만 (primary 1 + fallback 1) 수행하므로 재귀/순환은 발생하지 않는다.
// (이전엔 CHATGPT 단일 고정 — CHATGPT primary 면 재시도 없이 즉시 throw 였으나, codex 쿼터 소진 시
//  PM/Work Reviewer/PO/Impact 가 통째로 죽는 문제로 Claude fallback 을 추가했다.)
const FALLBACK_OF: Record<ModelProviderName, ModelProviderName> = {
  [ModelProviderName.CLAUDE]: ModelProviderName.CHATGPT,
  [ModelProviderName.CHATGPT]: ModelProviderName.CLAUDE,
};

@Injectable()
export class ModelRouterUsecase {
  private readonly logger = new Logger(ModelRouterUsecase.name);

  constructor(
    @Inject(MODEL_PROVIDER_TOKENS[ModelProviderName.CHATGPT])
    private readonly chatgptProvider: ModelProviderPort,
    @Inject(MODEL_PROVIDER_TOKENS[ModelProviderName.CLAUDE])
    private readonly claudeProvider: ModelProviderPort,
    // NotificationQueueModule 미연결 (테스트 / 부분 부팅) 환경 대비 — undefined 시 알람 skip.
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {}

  async route({
    agentType,
    request,
    noFallback,
  }: {
    agentType: AgentType;
    request: CompletionRequest;
    noFallback?: boolean;
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

      // noFallback (예: HUMANIZER 윤문) — primary 실패 시 반대편 provider 로 재시도하지 않고 즉시 전파.
      // best-effort 후처리가 ChatGPT 실패 시 Claude 로 새지 않도록 호출자가 명시 차단한다.
      if (noFallback) {
        throw this.wrapCompletionFailed({
          attempted: [primaryName],
          lastError: primaryError,
        });
      }

      const fallbackName = FALLBACK_OF[primaryName];
      // 대칭 매핑이라 정상적으론 발생하지 않지만, 매핑이 깨져 primary == fallback 이면 재시도 무의미 — 즉시 전파.
      if (!fallbackName || fallbackName === primaryName) {
        throw this.wrapCompletionFailed({
          attempted: [primaryName],
          lastError: primaryError,
        });
      }

      this.logger.warn(
        `primary provider(${primaryName}) 실패, fallback(${fallbackName}) 으로 재시도: ${primaryMessage}`,
      );

      const fallback = this.resolveProvider(fallbackName);
      try {
        return await fallback.complete(request);
      } catch (fallbackError: unknown) {
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        this.logger.error(
          `fallback provider(${fallbackName}) 도 실패: ${fallbackMessage}`,
        );
        // 양방향 fallback 으로 Claude 가 fallback 슬롯에 올 수 있다 (예: PM codex 쿼터 → Claude).
        // 이 경우 Claude 인증 의심도 owner 알람 대상 — primary 뿐 아니라 fallback 실패도 검사.
        this.maybeNotifyClaudeAuthSuspect(fallbackError);
        throw this.wrapCompletionFailed({
          attempted: [primaryName, fallbackName],
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
    // codex 쿼터 소진이 원인이면 "모델 호출 실패" 대신 reset 시각을 친절히 덧붙인다 (Slack 노출용).
    const quotaNotice = this.describeQuotaExhaustion([primaryError, lastError]);
    return new ModelRouterException({
      code: ModelRouterErrorCode.COMPLETION_FAILED,
      message: quotaNotice ? `${summary}. ${quotaNotice}` : summary,
      status: DomainStatus.BAD_GATEWAY,
      cause: primaryError ? { primaryError, lastError } : lastError,
    });
  }

  // primary / fallback 에러 중 codex 쿼터 소진(CodexQuotaExceededException) 이 있으면 친절 안내 문구를 만든다.
  private describeQuotaExhaustion(errors: unknown[]): string | null {
    for (const error of errors) {
      if (error instanceof CodexQuotaExceededException) {
        return error.resetHint
          ? `ChatGPT(codex) 사용량 한도 초과 — ${error.resetHint} 에 리셋됩니다. 잠시 후 다시 시도해주세요.`
          : 'ChatGPT(codex) 사용량 한도 초과 — 잠시 후 다시 시도해주세요.';
      }
    }
    return null;
  }

  // primary 실패가 ClaudeAuthSuspectException 일 때만 BullMQ queue 로 publish — consumer 가
  // 30분 dedupe + SlackService.postMessage 처리. publisher 가 fire-and-forget — 모델 호출 흐름과 분리.
  private maybeNotifyClaudeAuthSuspect(error: unknown): void {
    if (!(error instanceof ClaudeAuthSuspectException)) {
      return;
    }
    if (!this.notificationPublisher) {
      return;
    }
    this.notificationPublisher.publishClaudeAuthSuspect({
      exitMessage: error.message,
    });
  }

  private resolveProvider(name: ModelProviderName): ModelProviderPort {
    switch (name) {
      case ModelProviderName.CHATGPT:
        return this.chatgptProvider;
      case ModelProviderName.CLAUDE:
        return this.claudeProvider;
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
