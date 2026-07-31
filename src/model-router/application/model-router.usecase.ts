import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { MODEL_ROUTER_WORST_CASE_MS } from '../../common/llm/llm-timeout.constant';
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

// 에이전트 → 모델 매핑. 2026-07-02 정책: 이대리 전체를 ChatGPT(codex) 단일 provider 로 전환.
// Claude 는 primary·fallback 어디서도 사용하지 않는다(ClaudeCliProvider 코드는 롤백 대비 보존).
const AGENT_TO_PROVIDER: Record<AgentType, ModelProviderName> = {
  [AgentType.PM]: ModelProviderName.CHATGPT,
  [AgentType.BE]: ModelProviderName.CHATGPT,
  [AgentType.CODE_REVIEWER]: ModelProviderName.CHATGPT,
  [AgentType.WORK_REVIEWER]: ModelProviderName.CHATGPT,
  [AgentType.IMPACT_REPORTER]: ModelProviderName.CHATGPT,
  [AgentType.PO_SHADOW]: ModelProviderName.CHATGPT,
  [AgentType.BE_SCHEMA]: ModelProviderName.CHATGPT,
  [AgentType.BE_TEST]: ModelProviderName.CHATGPT,
  [AgentType.BE_SRE]: ModelProviderName.CHATGPT,
  [AgentType.BE_FIX]: ModelProviderName.CHATGPT,
  [AgentType.CTO]: ModelProviderName.CHATGPT,
  [AgentType.PO_EVAL]: ModelProviderName.CHATGPT,
  [AgentType.CEO]: ModelProviderName.CHATGPT,
  [AgentType.ISSUE_LABELER]: ModelProviderName.CHATGPT,
  [AgentType.VACATION]: ModelProviderName.CHATGPT,
  // BLOG — Hermes CLI(`hermes -z`)를 직접 spawn 하는 외부 에이전트라 route() 를 거치지 않는다.
  // 이 엔트리는 Record<AgentType,...> exhaustive 타입 충족용 sentinel 일 뿐 실제 호출되지 않음.
  [AgentType.BLOG]: ModelProviderName.CHATGPT,
  [AgentType.CAREER_MATE]: ModelProviderName.CHATGPT,
  [AgentType.JOB_APPLICATION]: ModelProviderName.CHATGPT,
  [AgentType.SUBCONSCIOUS_GATE]: ModelProviderName.CHATGPT,
  [AgentType.CONTRADICTION_JUDGE]: ModelProviderName.CHATGPT,
  // HUMANIZER — 보고서/프로필 서술 필드 윤문. HumanizeService 가 noFallback:true 로 호출(원본 유지).
  [AgentType.HUMANIZER]: ModelProviderName.CHATGPT,
  [AgentType.DOCS_AUDIT_OPTIMIZER]: ModelProviderName.CHATGPT,
  [AgentType.DOCS_AUDIT_EVALUATOR]: ModelProviderName.CHATGPT,
  [AgentType.PREFERENCE_LEARNING]: ModelProviderName.CHATGPT,
  // 저녁 회고→발행 후보 — codex 로 회고/후보 선별/블로그 본문 생성. BLOG(Hermes sentinel)와 달리 실제 route() 를 탄다.
  [AgentType.EVENING_RETRO]: ModelProviderName.CHATGPT,
  [AgentType.OPS_SUPERVISOR]: ModelProviderName.CHATGPT,
};

// fallback 테이블 — 2026-07-02 부터 비어 있음(Claude 제거로 ChatGPT 단일 provider).
// route() 의 `!fallbackName` 가드가 즉시 전파하므로, 모든 provider 는 실패 시 재시도 없이 즉시 throw 한다.
// (롤백: CLAUDE↔CHATGPT 대칭 매핑을 되살리면 이전 양방향 fallback 으로 복구된다.)
const FALLBACK_OF: Partial<Record<ModelProviderName, ModelProviderName>> = {};

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

  // 절전 직후 autopilot 실행 게이트용 — 현재 primary provider(CHATGPT/codex)가 지금 호출을
  // 받을 수 있는지 경량 확인한다. provider 가 probeReadiness 를 구현하지 않으면 "준비됨"(true)으로 본다.
  // (모든 agentType 이 CHATGPT 단일 provider 이므로 chatgptProvider 를 직접 probe 한다.)
  async probeReadiness(): Promise<boolean> {
    if (!this.chatgptProvider.probeReadiness) {
      return true;
    }
    return this.chatgptProvider.probeReadiness();
  }

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
    // route() 소요시간은 실패 시 예외 메시지로 흘려 AgentRun.output 에 보존한다 —
    // 로그는 휘발되지만 AgentRun 은 남으므로, 사후에 "지연이 route 안이었는지 밖이었는지" 를 가른다.
    const startedAtMs = Date.now();

    try {
      const completion = await primary.complete(request);
      this.warnIfSlow({
        agentType,
        providerName: primaryName,
        elapsedMs: Date.now() - startedAtMs,
      });
      return completion;
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
          elapsedMs: Date.now() - startedAtMs,
        });
      }

      const fallbackName = FALLBACK_OF[primaryName];
      // 대칭 매핑이라 정상적으론 발생하지 않지만, 매핑이 깨져 primary == fallback 이면 재시도 무의미 — 즉시 전파.
      if (!fallbackName || fallbackName === primaryName) {
        throw this.wrapCompletionFailed({
          attempted: [primaryName],
          lastError: primaryError,
          elapsedMs: Date.now() - startedAtMs,
        });
      }

      this.logger.warn(
        `primary provider(${primaryName}) 실패, fallback(${fallbackName}) 으로 재시도: ${primaryMessage}`,
      );

      const fallback = this.resolveProvider(fallbackName);
      try {
        const completion = await fallback.complete(request);
        this.warnIfSlow({
          agentType,
          providerName: fallbackName,
          elapsedMs: Date.now() - startedAtMs,
        });
        return completion;
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
          elapsedMs: Date.now() - startedAtMs,
        });
      }
    }
  }

  // route() 한 번의 이론상 최대치(codex timeout × bounded retry)를 넘겼다면 provider 안에서
  // timeout 이 듣지 않았다는 신호다. 2026-07-18/26 에 단일 실행이 약 32분(이론상 6분)까지
  // 늘어나 BullMQ lock 을 넘기고 stalled 중복 실행을 유발했으므로, 성공했더라도 남긴다.
  private warnIfSlow({
    agentType,
    providerName,
    elapsedMs,
  }: {
    agentType: AgentType;
    providerName: ModelProviderName;
    elapsedMs: number;
  }): void {
    if (elapsedMs <= MODEL_ROUTER_WORST_CASE_MS) {
      return;
    }
    this.logger.warn(
      `모델 호출이 이론상 최대치를 초과 — agent=${agentType} provider=${providerName} ` +
        `elapsed=${toElapsedSeconds(elapsedMs)}s (worst-case ${toElapsedSeconds(MODEL_ROUTER_WORST_CASE_MS)}s). ` +
        `provider timeout 이 동작하지 않았을 수 있습니다.`,
    );
  }

  private wrapCompletionFailed({
    attempted,
    lastError,
    primaryError,
    elapsedMs,
  }: {
    attempted: ModelProviderName[];
    lastError: unknown;
    primaryError?: unknown;
    elapsedMs: number;
  }): ModelRouterException {
    // 소요시간을 사용자 노출 문구에 함께 싣는다 — Slack 에서도 "왜 오래 걸렸나" 가 바로 보이고,
    // AgentRun.output.error 로 남아 사후 지연 구간 분석의 근거가 된다.
    const elapsed = `${toElapsedSeconds(elapsedMs)}s 소요`;
    const summary =
      attempted.length === 1
        ? `모델 호출 실패 (${attempted[0]}, ${elapsed})`
        : `모델 호출 실패 — primary ${attempted[0]} → fallback ${attempted[1]} 모두 실패 (${elapsed})`;
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

// 지연 분석은 초 단위면 충분하다 (ms 는 노이즈). 1초 미만 실패도 0s 로 뭉개지 않게 올림.
const toElapsedSeconds = (elapsedMs: number): number =>
  Math.max(1, Math.round(elapsedMs / 1000));
