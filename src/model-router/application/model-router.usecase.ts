import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { buildContractPreamble } from '../../agent-registry/agent-contract';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { getActiveAgentRunId } from '../../common/llm/active-agent-run.context';
import { MODEL_ROUTER_WORST_CASE_MS } from '../../common/llm/llm-timeout.constant';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { AGENT_TO_PROVIDER } from '../domain/agent-provider.map';
import { ModelRouterException } from '../domain/model-router.exception';
import {
  AgentType,
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelRouterErrorCode } from '../domain/model-router-error-code.enum';
import {
  MODEL_CALL_LOG_PORT,
  ModelCallLogInput,
  ModelCallLogPort,
} from '../domain/port/model-call-log.port';
import {
  MODEL_PROVIDER_TOKENS,
  ModelProviderPort,
} from '../domain/port/model-provider.port';
import { ClaudeAuthSuspectException } from '../infrastructure/claude-cli.provider';
import { CodexQuotaExceededException } from '../infrastructure/codex-cli.provider';

// fallback 테이블 — 2026-09-09 부터 CHATGPT 실패 시 CLAUDE 로 한 번 재시도한다.
// (2026-07-02 ~ 09-09 는 비어 있었다. codex 쿼터 소진·인증 만료가 그대로 실행 실패가 되는 구간이었다.)
//
// 역방향(CLAUDE → CHATGPT)은 넣지 않는다. AGENT_TO_PROVIDER 의 primary 가 전부 CHATGPT 라
// CLAUDE 가 primary 인 경로가 없고, 죽은 항목은 "양방향으로 돈다" 는 오해만 남긴다.
// CLAUDE 를 primary 로 쓰는 에이전트가 생기면 그때 대칭 항목을 추가할 것.
const FALLBACK_OF: Partial<Record<ModelProviderName, ModelProviderName>> = {
  [ModelProviderName.CHATGPT]: ModelProviderName.CLAUDE,
};

// model_call 오류 문자열 상한 — agent_run.output.cause 의 CAUSE_LEDGER_LIMIT 과 같은 값.
const CALL_LOG_ERROR_LIMIT = 1_000;
// 사용자 노출 문구에 싣는 fallback 실패 요지 길이. CLI stderr 는 여러 줄로 길어질 수 있어
// 첫 줄만, 짧게 싣는다 — 전문은 model_call·원장 cause 에 있다.
const FALLBACK_REASON_NOTICE_LIMIT = 120;

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
    // 모델 호출 기록 — 미주입(단위 테스트·부분 부팅) 시 skip.
    @Optional()
    @Inject(MODEL_CALL_LOG_PORT)
    private readonly callLog?: ModelCallLogPort,
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
    noContractPreamble,
  }: {
    agentType: AgentType;
    request: CompletionRequest;
    noFallback?: boolean;
    // 직무 계약 머리말을 붙이지 않는다. provider 선택만을 위해 남의 agentType 을 빌려 쓰는
    // 호출자가 명시적으로 끈다 — 아래 주입 지점 주석 참조.
    noContractPreamble?: boolean;
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

    // 직무 계약 머리말 주입 — 모델이 소속·산출물 규격·근거 요구를 모른 채 답하는 것을 막는다.
    // 스텁 계약은 null 을 돌려 주입하지 않으므로 기존 프롬프트가 그대로 간다.
    //
    // ⚠️ agentType 은 "누가 일하는가" 이자 "어느 provider 를 쓰는가" 두 뜻으로 쓰인다.
    //    IntentClassifier·ConversationalReply 는 실제 PM 업무가 아니라 provider 선택을 위해
    //    PM 을 차용하는데, 여기에 PM 계약(topPriority·morning·afternoon 을 내라)이 붙으면
    //    분류기의 고정 JSON 스키마·대화 응답의 1~3문장 지시와 충돌한다. 그 호출자들은
    //    noContractPreamble 로 끈다.
    const preamble = noContractPreamble
      ? null
      : buildContractPreamble(agentType);
    const routedRequest: CompletionRequest =
      preamble === null
        ? request
        : { ...request, prompt: `${preamble}\n\n${request.prompt}` };
    // route() 소요시간은 실패 시 예외 메시지로 흘려 AgentRun.output 에 보존한다 —
    // 로그는 휘발되지만 AgentRun 은 남으므로, 사후에 "지연이 route 안이었는지 밖이었는지" 를 가른다.
    const startedAtMs = Date.now();

    try {
      const completion = await primary.complete(routedRequest);
      this.warnIfSlow({
        agentType,
        providerName: primaryName,
        elapsedMs: Date.now() - startedAtMs,
      });
      this.recordCall({
        agentType,
        status: 'SUCCEEDED',
        provider: completion.provider,
        fallbackUsed: false,
        primaryError: null,
        fallbackError: null,
        durationMs: Date.now() - startedAtMs,
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
      //
      // outputSchema 를 건 요청도 같이 막는다. codex 는 `--output-schema` 로 형태를 강제하지만
      // claude CLI 에는 대응 인자가 없어(claude-cli.provider.ts 가 warn 을 남긴다) 프롬프트 지시만
      // 남는다. 호출자는 "스키마를 걸었으니 파싱은 안전하다" 는 전제로 결과를 다루므로, 형태가
      // 무너진 응답을 조용히 돌려주느니 primary 실패를 그대로 올린다.
      // (해당 호출: work-reviewer · po-shadow · blog 계열 · intent-classifier)
      // 이미지도 Claude CLI 가 받을 수 없으므로 Codex 실패를 그대로 전파한다.
      if (
        noFallback ||
        request.outputSchema !== undefined ||
        request.imagePaths?.length
      ) {
        throw this.wrapCompletionFailed({
          agentType,
          attempted: [primaryName],
          lastError: primaryError,
          elapsedMs: Date.now() - startedAtMs,
        });
      }

      const fallbackName = FALLBACK_OF[primaryName];
      // 대칭 매핑이라 정상적으론 발생하지 않지만, 매핑이 깨져 primary == fallback 이면 재시도 무의미 — 즉시 전파.
      if (!fallbackName || fallbackName === primaryName) {
        throw this.wrapCompletionFailed({
          agentType,
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
        const completion = await fallback.complete(routedRequest);
        this.warnIfSlow({
          agentType,
          providerName: fallbackName,
          elapsedMs: Date.now() - startedAtMs,
        });
        this.recordCall({
          agentType,
          status: 'SUCCEEDED',
          provider: completion.provider,
          fallbackUsed: true,
          primaryError: primaryMessage,
          fallbackError: null,
          durationMs: Date.now() - startedAtMs,
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
          agentType,
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

  // 실패 3갈래(noFallback·fallback 없음·양쪽 실패)가 전부 이 함수를 지나므로 실패 기록도 여기서 한다.
  private wrapCompletionFailed({
    agentType,
    attempted,
    lastError,
    primaryError,
    elapsedMs,
  }: {
    agentType: AgentType;
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
    const lastMessage = toErrorMessage(lastError);
    const fallbackUsed = attempted.length > 1;
    this.recordCall({
      agentType,
      status: 'FAILED',
      provider: attempted[attempted.length - 1],
      fallbackUsed,
      primaryError: fallbackUsed ? toErrorMessage(primaryError) : lastMessage,
      fallbackError: fallbackUsed ? lastMessage : null,
      durationMs: elapsedMs,
    });
    // 쿼터 안내만 있으면 fallback(Claude) 이 왜 실패했는지가 사용자에게 안 보인다 — 2026-09-16~18
    // 폴백 양쪽 실패 85건이 전부 "ChatGPT 한도 초과" 로만 읽혔다. 요지 한 줄을 덧붙인다.
    // CLI 출력이 이 문구째 Slack 으로 이스케이프 없이 나가므로(slack-handler.helper) `<!channel>`
    // 같은 제어 구문이 되지 않게 꺾쇠를 뺀다.
    const fallbackReason = fallbackUsed
      ? `${attempted[1]} 실패 사유: ${lastMessage
          .split('\n')[0]
          .replace(/[<>]/g, '')
          .slice(0, FALLBACK_REASON_NOTICE_LIMIT)}`
      : null;
    // 쿼터 안내는 마침표로 끝나므로 뒤에 붙일 때 마침표를 겹치지 않는다.
    const withQuota = quotaNotice ? `${summary}. ${quotaNotice}` : summary;
    const message =
      fallbackReason === null
        ? withQuota
        : `${withQuota}${withQuota.endsWith('.') ? '' : '.'} ${fallbackReason}`;
    return new ModelRouterException({
      code: ModelRouterErrorCode.COMPLETION_FAILED,
      message,
      status: DomainStatus.BAD_GATEWAY,
      cause: primaryError ? { primaryError, lastError } : lastError,
    });
  }

  // 모델 호출 한 번을 model_call 에 남긴다. 기다리지 않는다 — 기록이 응답을 늦추거나 실패로
  // 바꾸면 안 된다. 구현체가 이미 삼키지만 unhandled rejection 을 막으려 여기서도 받는다.
  private recordCall(input: Omit<ModelCallLogInput, 'agentRunId'>): void {
    if (!this.callLog) {
      return;
    }
    void this.callLog
      .record({
        ...input,
        agentRunId: getActiveAgentRunId() ?? null,
        primaryError:
          input.primaryError?.slice(0, CALL_LOG_ERROR_LIMIT) ?? null,
        fallbackError:
          input.fallbackError?.slice(0, CALL_LOG_ERROR_LIMIT) ?? null,
      })
      .catch(() => undefined);
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

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// 지연 분석은 초 단위면 충분하다 (ms 는 노이즈). 1초 미만 실패도 0s 로 뭉개지 않게 올림.
const toElapsedSeconds = (elapsedMs: number): number =>
  Math.max(1, Math.round(elapsedMs / 1000));
