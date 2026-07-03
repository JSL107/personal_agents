import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeCareerProfile } from '../../../humanize/application/humanize-career-profile.adapter';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CareerMateException } from '../domain/career-mate.exception';
import { ReflectPrInput, ReflectPrResult } from '../domain/career-mate.type';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import { extractPrReferences } from '../domain/extract-pr-reference';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildMultiPrRetroPrompt,
  buildPrRetroPrompt,
  MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT,
  parsePrRetroOutput,
  PR_RETRO_SYNTH_SYSTEM_PROMPT,
} from '../domain/prompt/pr-retro-synth.prompt';
import { mergeAccomplishment } from './merge-accomplishment';
import { RenderPortfolioUsecase } from './render-portfolio.usecase';

@Injectable()
export class ReflectPrUsecase {
  private readonly logger = new Logger(ReflectPrUsecase.name);

  // 다건 회고 시 프롬프트 폭발 방지용 diff 총예산(bytes)과 per-PR 하한.
  private static readonly TOTAL_DIFF_BUDGET = 80_000;
  private static readonly MIN_PER_PR_DIFF_BYTES = 8_000;

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly agentRunService: AgentRunService,
    private readonly config: ConfigService,
    private readonly humanizer: HumanizeService,
    private readonly renderPortfolio: RenderPortfolioUsecase,
  ) {}

  async execute({
    slackUserId,
    prText,
  }: ReflectPrInput): Promise<AgentRunOutcome<ReflectPrResult>> {
    const refs = extractPrReferences(prText); // 0건 시 INVALID_PR_REFERENCE
    const githubLogin = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    if (!githubLogin) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message:
          'IMPACT_REPORT_GITHUB_AUTHOR 가 설정되지 않았습니다 (.env 확인).',
        status: DomainStatus.INTERNAL,
      });
    }

    return this.agentRunService.execute<ReflectPrResult>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: {
        slackUserId,
        prs: refs.map((ref) => `${ref.repo}#${ref.number}`),
      },
      run: async (context) => {
        const perPrDiffBytes = Math.max(
          ReflectPrUsecase.MIN_PER_PR_DIFF_BYTES,
          Math.floor(ReflectPrUsecase.TOTAL_DIFF_BUDGET / refs.length),
        );
        const items = await Promise.all(
          refs.map(async (ref) => {
            const diffOptions =
              refs.length > 1 ? { ...ref, maxBytes: perPrDiffBytes } : ref;
            try {
              const [detail, diff] = await Promise.all([
                this.githubClient.getPullRequest(ref),
                this.githubClient.getPullRequestDiff(diffOptions),
              ]);
              return { detail, diff };
            } catch (error) {
              if (refs.length === 1) {
                throw error; // 단일: 기존 에러 전파 유지(회귀 0)
              }
              throw new CareerMateException({
                code: CareerMateErrorCode.INVALID_PR_REFERENCE,
                message: `PR ${ref.repo}#${ref.number} 를 가져오지 못했습니다 (없거나 접근 불가).`,
                status: DomainStatus.BAD_GATEWAY,
              });
            }
          }),
        );

        const isMulti = items.length > 1;
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: isMulti
              ? buildMultiPrRetroPrompt({ items })
              : buildPrRetroPrompt(items[0]),
            systemPrompt: isMulti
              ? MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT
              : PR_RETRO_SYNTH_SYSTEM_PROMPT,
          },
        });
        const { accomplishment, narrative } = parsePrRetroOutput(
          completion.text,
        );

        const latest = await this.repository.findLatestBySlackUser(slackUserId);
        const todayIsoDate = new Date().toISOString().slice(0, 10);
        const merged = mergeAccomplishment({
          latest: latest?.profileJson ?? null,
          accomplishment,
          githubLogin,
          todayIsoDate,
        });
        // humanizeCareerProfile 은 서술 필드만 윤문하고 meta 는 spread 로 보존한다(회귀 0).
        const humanized = await humanizeCareerProfile(merged, this.humanizer);

        await this.repository.save({
          agentRunId: context.agentRunId,
          slackUserId,
          githubLogin,
          windowStart: humanized.meta.windowStart,
          prCount: humanized.meta.prCount,
          summary: humanized.summary,
          profileJson: humanized,
        });

        // 방금 저장한 최신 프로필을 그대로 Notion 포트폴리오에 append (RenderPortfolio 재사용).
        const portfolio = await this.renderPortfolio.execute({ slackUserId });

        this.logger.log(
          `CAREER_MATE REFLECT_PR 완료 — PR ${refs
            .map((ref) => `${ref.repo}#${ref.number}`)
            .join(', ')}, 성과 ${humanized.accomplishments.length}건`,
        );

        const result: ReflectPrResult = {
          accomplishment,
          narrative,
          portfolioUrl: portfolio.url,
          agentRunId: context.agentRunId,
          modelUsed: completion.modelUsed,
        };
        return { result, modelUsed: completion.modelUsed, output: result };
      },
    });
  }
}
