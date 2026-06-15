import { Inject, Injectable } from '@nestjs/common';

import {
  RenderResumeInput,
  RenderResumeResult,
} from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

@Injectable()
export class RenderResumeUsecase {
  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
  ) {}

  async execute({
    slackUserId,
  }: RenderResumeInput): Promise<RenderResumeResult> {
    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    if (latest) {
      return {
        profile: latest.profileJson,
        agentRunId: latest.agentRunId ?? 0,
      };
    }
    const built = await this.buildProfile.execute({ slackUserId });
    return { profile: built.result, agentRunId: built.agentRunId };
  }
}
