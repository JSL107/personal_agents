import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { CareerMateException } from '../domain/career-mate.exception';
import {
  AnalyzeJdGapInput,
  CareerProfileData,
  GapAnalysisData,
} from '../domain/career-mate.type';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildJdGapPrompt,
  JD_GAP_SYSTEM_PROMPT,
  parseGapAnalysisOutput,
} from '../domain/prompt/jd-gap.prompt';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

const PREVIEW_TTL_MS = 30 * 60 * 1000; // 30분 — 주제 선택 대기

@Injectable()
export class AnalyzeJdGapUsecase {
  private readonly logger = new Logger(AnalyzeJdGapUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    jdText,
  }: AnalyzeJdGapInput): Promise<AgentRunOutcome<GapAnalysisData>> {
    if (jdText.trim().length === 0) {
      throw new CareerMateException({
        code: CareerMateErrorCode.JD_EMPTY,
        message: '분석할 공고(JD) 내용을 함께 붙여주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    return this.agentRunService.execute<GapAnalysisData>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: { slackUserId, jdLength: jdText.length },
      run: async () => {
        const profile = await this.resolveProfile(slackUserId);
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildJdGapPrompt(profile, jdText),
            systemPrompt: JD_GAP_SYSTEM_PROMPT,
          },
        });
        const data = parseGapAnalysisOutput(completion.text);
        await this.createPreview.execute({
          slackUserId,
          kind: PREVIEW_KIND.CAREER_JD_GAP_BLOG,
          payload: { topics: data.topics },
          previewText: 'JD 갭 분석 — 블로그 주제 선택 대기',
          responseUrl: null,
          ttlMs: PREVIEW_TTL_MS,
        });
        this.logger.log(
          `CAREER_MATE JD 갭 분석 — gaps=${data.gaps.length} topics=${data.topics.length}`,
        );
        return { result: data, modelUsed: completion.modelUsed, output: data };
      },
    });
  }

  private async resolveProfile(
    slackUserId: string,
  ): Promise<CareerProfileData> {
    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    if (latest) {
      return latest.profileJson;
    }
    const built = await this.buildProfile.execute({ slackUserId });
    return built.result;
  }
}
