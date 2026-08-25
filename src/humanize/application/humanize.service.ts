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
import {
  findPreservationViolations,
  PreservationViolation,
  PreservedTokenKind,
  shouldRollbackField,
} from '../domain/content-preservation';
import { parseHumanizeOutput } from '../domain/humanize-output.parser';
import {
  HUMANIZE_CONCISE_RULES,
  HUMANIZE_GENERAL_AUDIENCE_TERM_LINE,
  HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT,
  HUMANIZE_SYSTEM_PROMPT,
  HUMANIZE_TERM_PRESERVE_LINE,
} from '../domain/humanize-system.prompt';

/**
 * 목표 문체.
 *
 * - `report`(기본): 보고서·Slack 카드용 문어체. 기존 모든 호출부가 이 값이다.
 * - `personal-blog`: 사용자 명의로 공개되는 블로그 본문. 보고체 지시를 빼고 개인 문체를 넣는다.
 */
export type HumanizeVoice = 'report' | 'personal-blog';

/**
 * 읽는 사람. 목소리(`voice`)가 "어디에 실리는 글인가" 라면 이 축은 "누가 읽는가" 다 — 둘은 곱해서 쓴다.
 *
 * - `developer`(기본): 지금까지의 동작. 영어 용어를 그대로 둔다.
 * - `general`: 개발자가 아닌 독자. 옮길 수 있는 영어는 한국어로 풀고, 남기는 용어에는 첫 등장 풀이를 붙인다.
 */
export type HumanizeAudience = 'developer' | 'general';

export interface HumanizeOptions {
  /**
   * 분량이 필요한 산출물(블로그 본문·이력서 서술)이라 길이 예산을 걸지 않는다.
   *
   * 기본은 간결 모드다 — 윤문 결과의 대다수가 Slack 카드로 훑어 읽히기 때문이다.
   */
  longForm?: boolean;
  voice?: HumanizeVoice;
  /**
   * 기본은 `developer` 다 — 지정하지 않은 모든 기존 호출부의 산출물이 그대로 유지된다.
   */
  audience?: HumanizeAudience;
}

type PreservationViolationCounts = Record<PreservedTokenKind, number>;

type PreservationViolationSummary = Record<
  PreservationViolation['direction'],
  PreservationViolationCounts
>;

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
        // 두 축을 함께 남긴다. 없으면 원장에서 "이 회차가 어떤 목소리·독자로 돌았나" 를
        // 되짚을 수 없어, 산출물이 이상할 때 프롬프트 문제인지 축 지정 문제인지 갈리지 않는다.
        inputSnapshot: {
          fieldKeys: keys,
          voice: options?.voice ?? 'report',
          audience: options?.audience ?? 'developer',
        },
        run: async () => {
          const injection = this.preferenceProfile
            ? await this.preferenceProfile.getInjectionBlock('humanize')
            : '';
          const voicePrompt =
            options?.voice === 'personal-blog'
              ? HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT
              : HUMANIZE_SYSTEM_PROMPT;
          // 독자 축은 목소리 위에 겹쳐 적용한다 — 용어 보존 한 줄만 갈아끼우므로
          // 나머지 지시(문체·길이 예산)는 두 축 모두에서 그대로 살아 있다.
          //
          // `general` 은 용어 풀이가 붙어 글이 길어지므로 아래 길이 예산과 방향이 반대다.
          // 지금은 부딪히지 않는다 — `general` 을 넘기는 유일한 경로(마크다운 어댑터)가
          // `longForm: true` 라 예산 자체가 안 붙는다. Slack 카드처럼 훑어 읽는 산출물에
          // `general` 을 쓰게 되면 그때 둘 중 하나를 완화해야 한다.
          const audiencePrompt =
            options?.audience === 'general'
              ? voicePrompt.replace(
                  HUMANIZE_TERM_PRESERVE_LINE,
                  HUMANIZE_GENERAL_AUDIENCE_TERM_LINE,
                )
              : voicePrompt;
          const basePrompt = options?.longForm
            ? audiencePrompt
            : `${audiencePrompt}\n${HUMANIZE_CONCISE_RULES}`;
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
          const rolledBackKeys: string[] = [];
          const violationsByKey: Record<string, PreservationViolation[]> = {};
          const preservationViolations = createViolationSummary();

          for (const key of keys) {
            const violations = findPreservationViolations(
              fields[key],
              humanized[key],
            );
            addViolationsToSummary(preservationViolations, violations);
            if (shouldRollbackField(violations)) {
              humanized[key] = fields[key];
              rolledBackKeys.push(key);
              violationsByKey[key] = violations;
            }
          }

          if (rolledBackKeys.length > 0) {
            this.logger.warn(
              buildRollbackWarning(rolledBackKeys, violationsByKey),
            );
          }

          return {
            result: { ...fields, ...humanized },
            modelUsed: completion.modelUsed,
            // 윤문 본문은 원장에 담지 않는다 — 보고서 전문이 그대로 복제된다.
            output: {
              humanizedKeys: Object.keys(humanized),
              rolledBackKeys,
              preservationViolations,
            },
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

const createViolationSummary = (): PreservationViolationSummary => {
  return {
    injected: { code: 0, url: 0, pr: 0, number: 0 },
    lost: { code: 0, url: 0, pr: 0, number: 0 },
  };
};

const addViolationsToSummary = (
  summary: PreservationViolationSummary,
  violations: PreservationViolation[],
): void => {
  for (const violation of violations) {
    summary[violation.direction][violation.kind] += 1;
  }
};

const buildRollbackWarning = (
  rolledBackKeys: string[],
  violationsByKey: Record<string, PreservationViolation[]>,
): string => {
  const details = rolledBackKeys.map((key) => {
    const violations = violationsByKey[key]
      .map(
        (violation) =>
          `${violation.direction} ${violation.kind} ${formatViolationTokenForLog(violation)}`,
      )
      .join(', ');
    return `${key}: ${violations}`;
  });
  return `윤문 내용 보존 롤백 — ${details.join('; ')}`;
};

const formatViolationTokenForLog = (
  violation: PreservationViolation,
): string => {
  const token =
    violation.kind === 'url'
      ? redactUrlForLog(violation.token)
      : violation.token;
  return JSON.stringify(token);
};

const redactUrlForLog = (token: string): string => {
  try {
    const url = new URL(token);
    return `${url.origin}${url.pathname}`;
  } catch {
    const urlWithoutQueryOrFragment = token.split(/[?#]/)[0];
    return urlWithoutQueryOrFragment.replace(/^(https?:\/\/)[^/?#]*@/i, '$1');
  }
};
