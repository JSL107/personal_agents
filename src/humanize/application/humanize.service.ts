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
import { parseHumanizeOutput } from '../domain/humanize-output.parser';
import {
  HUMANIZE_CONCISE_RULES,
  HUMANIZE_GENERAL_AUDIENCE_TERM_LINE,
  HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT,
  HUMANIZE_SYSTEM_PROMPT,
  HUMANIZE_TERM_PRESERVE_LINE,
} from '../domain/humanize-system.prompt';
import {
  findKoreanStyleGaps,
  measureKoreanStyle,
} from '../domain/korean-style-metrics';
import {
  renderStyleFeedback,
  toStyleFeedbackRun,
  voiceOf,
} from '../domain/style-feedback';

/**
 * 목표 문체.
 *
 * - `report`(기본): 보고서·Slack 카드용 문어체. 기존 모든 호출부가 이 값이다.
 * - `personal-blog`: 사용자 명의로 공개되는 블로그 본문. 보고체 지시를 빼고 개인 문체를 넣는다.
 */
// 문체 되먹임은 사용자 명의 글에만 쓴다. 목표 수치가 사용자 글에서 잰 재현 대상이라,
// 내부 보고서에 그 문체를 강요하면 목적이 뒤집힌다.
const STYLE_FEEDBACK_VOICE = 'personal-blog';
// 원장에서 훑을 최근 실행 수. 목소리 필터가 조회 **뒤에** 걸리므로(포트가 voice 필터를
// 받지 않는다) 넉넉히 가져와 걸러야 개인 글 표본이 모인다.
const STYLE_FEEDBACK_SCAN_LIMIT = 40;
// 그중 실제로 볼 최근 편수.
const STYLE_FEEDBACK_RUNS = 5;
const STYLE_FEEDBACK_DAYS = 60;

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
          const styleFeedback = await this.buildStyleFeedback(options?.voice);
          const systemPrompt =
            (injection ? `${basePrompt}\n\n${injection}` : basePrompt) +
            styleFeedback;
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
          return {
            result: { ...fields, ...humanized },
            modelUsed: completion.modelUsed,
            // 윤문 본문은 원장에 담지 않는다 — 보고서 전문이 그대로 복제된다.
            // 문체 갭은 숫자 몇 줄이라 담아도 원장이 부풀지 않고, 다음 회차 되먹임의
            // 유일한 재료다. 40문장 미만이면 판정이 무의미해 빈 배열이 온다.
            output: {
              humanizedKeys: Object.keys(humanized),
              styleGaps: findKoreanStyleGaps(
                measureKoreanStyle(Object.values(humanized).join('\n\n')),
              ),
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

  /**
   * 최근 개인 글 윤문본에서 되풀이된 문체 갭을 프롬프트 블록으로 만든다.
   * 조회 실패는 되먹임 없이 진행(best-effort) — 윤문 자체가 best-effort 경로라
   * 되먹임 때문에 본문이 원본으로 떨어지면 손해가 더 크다.
   */
  private async buildStyleFeedback(voice?: HumanizeVoice): Promise<string> {
    if (voice !== STYLE_FEEDBACK_VOICE) {
      return '';
    }
    try {
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType: AgentType.HUMANIZER,
        sinceDays: STYLE_FEEDBACK_DAYS,
        limit: STYLE_FEEDBACK_SCAN_LIMIT,
      });
      const samples = runs
        .filter((run) => voiceOf(run.inputSnapshot) === STYLE_FEEDBACK_VOICE)
        .map((run) => toStyleFeedbackRun(run.output))
        .filter(
          (sample): sample is NonNullable<typeof sample> => sample !== null,
        )
        .slice(0, STYLE_FEEDBACK_RUNS);
      const block = renderStyleFeedback(samples);
      if (block.length > 0) {
        this.logger.log(`문체 되먹임 주입 — 최근 ${samples.length}편 기준`);
      }
      return block;
    } catch (error: unknown) {
      this.logger.warn(
        `문체 되먹임 조회 실패, 되먹임 없이 진행: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }
}
