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
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CareerMateException } from '../domain/career-mate.exception';
import {
  BuildCareerProfileInput,
  CareerProfileData,
} from '../domain/career-mate.type';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildSynthPrompt,
  CAREER_PROFILE_SYNTH_SYSTEM_PROMPT,
  parseCareerProfileOutput,
} from '../domain/prompt/career-profile-synth.prompt';

const DEFAULT_WINDOW_MONTHS = 12;
const PR_LIMIT = 100;

@Injectable()
export class BuildCareerProfileUsecase {
  private readonly logger = new Logger(BuildCareerProfileUsecase.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly agentRunService: AgentRunService,
    private readonly config: ConfigService,
  ) {}

  async execute({
    slackUserId,
    windowMonths = DEFAULT_WINDOW_MONTHS,
  }: BuildCareerProfileInput): Promise<AgentRunOutcome<CareerProfileData>> {
    const githubLogin = this.config.get<string>('GITHUB_OWNER_LOGIN');
    if (!githubLogin) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message:
          'GITHUB_OWNER_LOGIN 이 설정되지 않았습니다 (.env 확인). 프로필을 만들 수 없습니다.',
        status: DomainStatus.INTERNAL,
      });
    }

    const since = new Date();
    since.setMonth(since.getMonth() - windowMonths);
    const sinceIsoDate = since.toISOString().slice(0, 10);

    const prs = await this.githubClient.listAuthorMergedPullRequestsSince({
      repo: null,
      author: githubLogin,
      sinceIsoDate,
      limit: PR_LIMIT,
    });
    if (prs.length === 0) {
      throw new CareerMateException({
        code: CareerMateErrorCode.NO_EVIDENCE,
        message: `최근 ${windowMonths}개월 내 merged PR 이 없습니다 — 기간을 늘려 다시 요청하세요.`,
        status: DomainStatus.NOT_FOUND,
      });
    }

    return this.agentRunService.execute<CareerProfileData>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: {
        slackUserId,
        windowMonths,
        sinceIsoDate,
        prCount: prs.length,
      },
      run: async (context) => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildSynthPrompt(prs),
            systemPrompt: CAREER_PROFILE_SYNTH_SYSTEM_PROMPT,
          },
        });
        const data = parseCareerProfileOutput(completion.text);
        data.meta = {
          githubLogin,
          windowStart: sinceIsoDate,
          prCount: prs.length,
        };
        await this.repository.save({
          agentRunId: context.agentRunId,
          slackUserId,
          githubLogin,
          windowStart: sinceIsoDate,
          prCount: prs.length,
          summary: data.summary,
          profileJson: data,
        });
        this.logger.log(
          `CAREER_MATE 프로필 합성 완료 — PR ${prs.length}건, 스킬 ${data.skills.length}, 성과 ${data.accomplishments.length}`,
        );
        return { result: data, modelUsed: completion.modelUsed, output: data };
      },
    });
  }
}
