import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  AuditResumeInput,
  CareerProfileData,
  CareerTargetJdData,
  ResumeAuditResult,
} from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  CAREER_TARGET_JD_REPOSITORY_PORT,
  CareerTargetJdRepositoryPort,
} from '../domain/port/career-target-jd.repository.port';
import {
  buildResumeAuditPrompt,
  parseResumeAuditOutput,
  RESUME_AUDIT_SYSTEM_PROMPT,
} from '../domain/prompt/resume-audit.prompt';
import { applyAuditGuards } from '../domain/resume-audit.guard';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

export const TARGET_JD_MAX_AGE_DAYS = 30;

const toJdSource = (
  targetJd: CareerTargetJdData | null,
): ResumeAuditResult['jdSource'] => {
  if (!targetJd) {
    return null;
  }
  return {
    company: targetJd.company,
    role: targetJd.role,
    registeredAt: targetJd.createdAt.toISOString(),
  };
};

@Injectable()
export class AuditResumeUsecase {
  private readonly logger = new Logger(AuditResumeUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    @Inject(CAREER_TARGET_JD_REPOSITORY_PORT)
    private readonly targetJdRepository: CareerTargetJdRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    triggerType,
  }: AuditResumeInput): Promise<AgentRunOutcome<ResumeAuditResult>> {
    return this.agentRunService.execute<ResumeAuditResult>({
      agentType: AgentType.CAREER_MATE,
      triggerType,
      inputSnapshot: { slackUserId },
      run: async () => {
        const profile = await this.resolveProfile(slackUserId);
        const targetJd = await this.targetJdRepository.findActiveBySlackUser(
          slackUserId,
          TARGET_JD_MAX_AGE_DAYS,
        );
        if (profile.accomplishments.length === 0) {
          const result = this.emptyResult(targetJd);
          this.logger.log(
            `CAREER_MATE 이력서 감사 — weak=0 missing=0 demoted=0 unjudged=0 jd=${Boolean(targetJd)}`,
          );
          return {
            result,
            modelUsed: 'deterministic',
            output: result,
          };
        }
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildResumeAuditPrompt(profile, targetJd),
            systemPrompt: RESUME_AUDIT_SYSTEM_PROMPT,
          },
        });
        const guarded = applyAuditGuards(
          parseResumeAuditOutput(completion.text),
          profile,
        );
        const result: ResumeAuditResult = {
          ...guarded,
          // 등록된 공고가 없으면 모델이 낸 jdFindings 를 버린다. 프롬프트는 빈 배열을 요구하지만
          // 모델이 계약을 어기면 존재하지 않는 공고의 요구사항이 정상 결과처럼 화면에 오른다.
          jdFindings: targetJd ? guarded.jdFindings : [],
          jdSource: toJdSource(targetJd),
        };
        const weakCount = result.items.filter(
          (item) => item.status === 'WEAK',
        ).length;
        const missingCount = result.items.filter(
          (item) => item.status === 'MISSING',
        ).length;
        this.logger.log(
          `CAREER_MATE 이력서 감사 — weak=${weakCount} missing=${missingCount} demoted=${result.guard.demotedTitles.length} unjudged=${result.guard.unjudgedTitles.length} jd=${Boolean(targetJd)}`,
        );
        return {
          result,
          modelUsed: completion.modelUsed,
          output: result,
        };
      },
    });
  }

  private emptyResult(targetJd: CareerTargetJdData | null): ResumeAuditResult {
    return {
      verdict: '판정할 성과가 없습니다.',
      items: [],
      highlights: [],
      jdFindings: [],
      rejectionRisks: [],
      guard: {
        demotedTitles: [],
        droppedTitles: [],
        unjudgedTitles: [],
        forcedMissing: [],
        rewriteMissing: [],
        droppedHighlights: [],
      },
      jdSource: toJdSource(targetJd),
    };
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
