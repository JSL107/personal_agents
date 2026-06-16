import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  CalibrateResumeInput,
  CalibrationResultData,
  CareerProfileData,
} from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildCalibrationPrompt,
  CALIBRATION_SYSTEM_PROMPT,
  parseCalibrationOutput,
} from '../domain/prompt/calibration.prompt';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

@Injectable()
export class CalibrateResumeUsecase {
  private readonly logger = new Logger(CalibrateResumeUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    webTrendsNote,
  }: CalibrateResumeInput): Promise<AgentRunOutcome<CalibrationResultData>> {
    return this.agentRunService.execute<CalibrationResultData>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: { slackUserId, hasWebTrends: Boolean(webTrendsNote) },
      run: async () => {
        const profile = await this.resolveProfile(slackUserId);
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildCalibrationPrompt(profile, webTrendsNote),
            systemPrompt: CALIBRATION_SYSTEM_PROMPT,
          },
        });
        const data = parseCalibrationOutput(completion.text);
        this.logger.log(
          `CAREER_MATE 보정 점검 — actions=${data.actionItems.length} web=${Boolean(webTrendsNote)}`,
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
