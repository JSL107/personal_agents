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
import { extractPrReference } from '../domain/extract-pr-reference';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildPrRetroPrompt,
  parsePrRetroOutput,
  PR_RETRO_SYNTH_SYSTEM_PROMPT,
} from '../domain/prompt/pr-retro-synth.prompt';
import { mergeAccomplishment } from './merge-accomplishment';
import { RenderPortfolioUsecase } from './render-portfolio.usecase';

@Injectable()
export class ReflectPrUsecase {
  private readonly logger = new Logger(ReflectPrUsecase.name);

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
    const ref = extractPrReference(prText); // 미검출 시 INVALID_PR_REFERENCE
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
      inputSnapshot: { slackUserId, repo: ref.repo, prNumber: ref.number },
      run: async (context) => {
        const [detail, diff] = await Promise.all([
          this.githubClient.getPullRequest(ref),
          this.githubClient.getPullRequestDiff(ref),
        ]);

        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildPrRetroPrompt({ detail, diff }),
            systemPrompt: PR_RETRO_SYNTH_SYSTEM_PROMPT,
          },
        });
        const { accomplishment, narrative } = parsePrRetroOutput(
          completion.text,
        );

        const latest =
          await this.repository.findLatestBySlackUser(slackUserId);
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
          `CAREER_MATE REFLECT_PR 완료 — ${ref.repo}#${ref.number}, 성과 ${humanized.accomplishments.length}건`,
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
