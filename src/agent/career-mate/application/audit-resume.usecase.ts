import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { getTodayKstDate } from '../../../common/util/kst-date.util';
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
import { selectAuditWindow } from '../domain/resume-audit.window';
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
        // 성과가 상한을 넘으면 이번 회차가 볼 구간만 고른다. 전량을 한 번에 실으면 입력과
        // 출력(성과 1 건마다 판정·인용·재작성)이 함께 커져 모델 캡(300s)을 넘긴다 — 실측으로
        // 09-07 부터 5 회 연속 전멸했다(자세한 근거는 selectAuditWindow 주석).
        // 창 밖 성과는 사라지지 않는다: 가드가 UNJUDGED 로 채워 화면에 남기고, 날짜 시드
        // 순환이라 며칠이면 한 바퀴 돈다.
        const auditWindow = selectAuditWindow({
          accomplishments: profile.accomplishments,
          todayKst: getTodayKstDate(),
        });
        const windowedProfile: CareerProfileData = {
          ...profile,
          accomplishments: auditWindow.selected,
        };
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            // 판정 대상은 창 안 성과지만 jdFindings·rejectionRisks 는 이력서 전체를 보고
            // 답해야 한다. 전체 목록(제목+bullet)을 따로 넘겨, 공고 요구의 근거가 창 밖에
            // 있을 때 MISSING 으로 오판하는 것을 막는다.
            prompt: buildResumeAuditPrompt(
              windowedProfile,
              targetJd,
              auditWindow.label,
              profile.accomplishments,
            ),
            systemPrompt: RESUME_AUDIT_SYSTEM_PROMPT,
          },
        });
        // 가드에는 **전체** profile 을 넘긴다. 창을 적용한 쪽을 넘기면 범위 밖 성과가
        // unjudged 집계에서 빠져 화면에서 조용히 사라진다 — 그때 사용자는 이력서에서
        // 그 성과가 없어진 것으로 읽는다.
        const guarded = applyAuditGuards(
          parseResumeAuditOutput(completion.text),
          profile,
          auditWindow.outOfWindowTitles,
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
        // 범위를 로그에 남긴다. 없으면 unjudged 가 수십 건 찍힌 회차를 두고 "모델이 계약을
        // 어겼나" 와 "범위 분할이 정상 동작했나" 를 사후에 가를 수 없다.
        this.logger.log(
          `CAREER_MATE 이력서 감사 — weak=${weakCount} missing=${missingCount} demoted=${result.guard.demotedTitles.length} unjudged=${result.guard.unjudgedTitles.length} jd=${Boolean(targetJd)} 범위=${auditWindow.label ?? '전량'}`,
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
        outOfWindowTitles: [],
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
