import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../../agent/blog/domain/port/hermes-runner.port';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
  CareerProfileSnapshot,
} from '../../agent/career-mate/domain/port/career-profile.repository.port';
import { EvaluateStudyTopicUsecase } from '../../agent/cto/application/evaluate-study-topic.usecase';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  INSTALLED_TOOLS_PORT,
  InstalledToolsPort,
} from '../domain/port/installed-tools.port';
import {
  RecentStudyBrief,
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import { StudyBriefException } from '../domain/study-brief.exception';
import {
  buildStudyResearchPrompt,
  BuildStudyResearchPromptInput,
  STUDY_BRIEF_CRON_QUEUE,
  StudyBriefCronJobData,
  StudyKindBalance,
} from '../domain/study-brief-cron.type';
import { StudyBriefErrorCode } from '../domain/study-brief-error-code.enum';
import {
  parseStudyResearch,
  StudyResearchResult,
  StudyResearchSkipped,
} from '../domain/study-research.parser';
import { formatStudyBrief } from './study-brief.formatter';

const SENT_GUARD_TTL_SECONDS = 90_000;
// Hermes(12분) + CTO route 최악 경로(10분)와 context/Slack 여유를 함께 덮는다.
const PROCESSING_GUARD_TTL_SECONDS = 30 * 60;
const RECENT_TOPIC_DAYS = 30;
const KIND_BALANCE_LIMIT = 5;

interface StudyMaterials {
  profile: CareerProfileSnapshot | undefined;
  recentBriefs: RecentStudyBrief[];
  installedTools: string[];
}

interface DeliverStudyBriefInput {
  target: string;
  topic: string;
  summary: string;
  detail: string;
  guardKey: string;
}

@Processor(STUDY_BRIEF_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class StudyBriefCronConsumer extends WorkerHost {
  private readonly logger = new Logger(StudyBriefCronConsumer.name);

  constructor(
    private readonly evaluateStudyTopic: EvaluateStudyTopicUsecase,
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly profileRepository: CareerProfileRepositoryPort,
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
    @Inject(STUDY_BRIEF_REPOSITORY_PORT)
    private readonly studyBriefRepository: StudyBriefRepositoryPort,
    @Inject(INSTALLED_TOOLS_PORT)
    private readonly installedTools: InstalledToolsPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<StudyBriefCronJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    const dateKey = getTodayKstDate();
    const guardKey = `cron:${STUDY_BRIEF_CRON_QUEUE}:${dateKey}`;
    const processingGuardKey = `${guardKey}:processing`;
    let ownsProcessingGuard = false;
    this.logger.log(
      `Study Brief Cron 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );

    try {
      if (await this.cronIdempotency.isDone(guardKey)) {
        this.logger.warn(`Study Brief Cron 중복 처리 차단 — ${dateKey}`);
        return;
      }
      ownsProcessingGuard = await this.cronIdempotency.acquireOnce(
        processingGuardKey,
        PROCESSING_GUARD_TTL_SECONDS,
      );
      if (!ownsProcessingGuard) {
        this.logger.warn(`Study Brief Cron 동시 처리 차단 — ${dateKey}`);
        return;
      }

      const materials = await this.collectMaterials(ownerSlackUserId);
      const research = await this.research(materials);
      if (isSkippedResearch(research)) {
        // NO_TOPIC은 CTO를 호출하지 않으므로 AgentRun도 남지 않는다. BullMQ 완료 이력과 이 로그가 실행 근거다.
        this.logger.log(
          `Study Brief Cron 소재 없음 — ${research.skippedReason}`,
        );
        return;
      }

      const outcome = await this.evaluateStudyTopic.execute({
        slackUserId: ownerSlackUserId,
        research: {
          kind: research.kind,
          topic: research.topic,
          reportMd: research.reportMd,
          sourceUrls: research.sourceUrls,
        },
        profileSummary: materials.profile?.profileJson.summary,
        profileSkills: materials.profile?.profileJson.skills.map(
          (skill) => `${skill.name}(${skill.proficiency})`,
        ),
      });
      await this.studyBriefRepository.save({
        agentRunId: outcome.agentRunId,
        ownerUserId: ownerSlackUserId,
        kind: research.kind,
        topic: research.topic,
        verdict: outcome.result,
        reportMd: research.reportMd,
        sourceUrls: research.sourceUrls,
      });

      const rendered = formatStudyBrief({
        topic: research.topic,
        verdict: outcome.result,
        reportMd: research.reportMd,
      });
      await this.deliverOnce({
        target,
        topic: research.topic,
        summary: rendered.summary,
        detail: rendered.full,
        guardKey,
      });
    } catch (error) {
      this.logger.error(
        `Study Brief Cron 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    } finally {
      if (ownsProcessingGuard) {
        await this.cronIdempotency.release(processingGuardKey);
      }
    }
  }

  private async collectMaterials(
    ownerSlackUserId: string,
  ): Promise<StudyMaterials> {
    const [profile, recentBriefs, installedTools] = await Promise.all([
      this.collectProfile(ownerSlackUserId),
      this.collectRecentBriefs(ownerSlackUserId),
      this.collectInstalledTools(),
    ]);
    return { profile, recentBriefs, installedTools };
  }

  private async collectProfile(
    ownerSlackUserId: string,
  ): Promise<CareerProfileSnapshot | undefined> {
    try {
      const profile =
        await this.profileRepository.findLatestBySlackUser(ownerSlackUserId);
      if (!profile) {
        this.logger.warn(
          `Study Brief 역량 프로필 없음 — 기본 개발자 설명 사용 (owner=${ownerSlackUserId})`,
        );
        return undefined;
      }
      return profile;
    } catch (error) {
      this.logger.warn(
        `Study Brief 역량 프로필 조회 실패 — 기본 설명 사용: ${formatError(error)}`,
      );
      return undefined;
    }
  }

  private async collectRecentBriefs(
    ownerSlackUserId: string,
  ): Promise<RecentStudyBrief[]> {
    const since = new Date(
      Date.now() - RECENT_TOPIC_DAYS * 24 * 60 * 60 * 1000,
    );
    try {
      return await this.studyBriefRepository.findRecentSince(
        ownerSlackUserId,
        since,
      );
    } catch (error) {
      this.logger.warn(
        `Study Brief 최근 주제 조회 실패 — 제외 목록 없이 진행: ${formatError(error)}`,
      );
      return [];
    }
  }

  private async collectInstalledTools(): Promise<string[]> {
    try {
      return await this.installedTools.collect();
    } catch (error) {
      this.logger.warn(
        `Study Brief 설치 도구 수집 실패 — 빈 목록으로 진행: ${formatError(error)}`,
      );
      return [];
    }
  }

  private async research(
    materials: StudyMaterials,
  ): Promise<StudyResearchResult | StudyResearchSkipped> {
    const promptInput: BuildStudyResearchPromptInput = {
      profileSkills: materials.profile?.profileJson.skills.map(
        (skill) => `${skill.name}(${skill.proficiency})`,
      ),
      recentTopics: materials.recentBriefs.map((brief) => brief.topic),
      kindBalance: calculateKindBalance(materials.recentBriefs),
      installedTools: materials.installedTools,
    };
    const result = await this.hermesRunner.run(
      buildStudyResearchPrompt(promptInput),
    );
    return parseStudyResearch(result.stdout);
  }

  private async deliverOnce({
    target,
    topic,
    summary,
    detail,
    guardKey,
  }: DeliverStudyBriefInput): Promise<void> {
    const firstRun = await this.cronIdempotency.acquireOnce(
      guardKey,
      SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(`Study Brief Cron 중복 발송 차단 — ${guardKey}`);
      return;
    }

    let threadTs: string | undefined;
    try {
      const result = await this.slackNotifier.postMessage({
        target,
        text: summary,
      });
      threadTs = result.ts;
    } catch (error) {
      // 완료 가드를 유지해야 BullMQ 재시도가 조사·판정·저장을 다시 실행하지 않는다.
      // 저장된 주제와 조사 전문은 DB 정본으로 남고, 실패 알림으로만 후속 대응한다.
      throw new StudyBriefException({
        code: StudyBriefErrorCode.DELIVERY_FAILED,
        message: `Study Brief Slack 발송 실패 — 놓친 주제: ${topic}; ${formatError(error)}`,
        status: DomainStatus.INTERNAL,
        cause: error,
      });
    }

    if (threadTs) {
      // 상세 스레드 실패는 요약 발송을 무효화하지 않는다. reportMd는 DB에 정본으로 보존된다.
      try {
        await this.slackNotifier.postMessage({
          target,
          text: detail,
          threadTs,
        });
      } catch (error) {
        this.logger.warn(
          `Study Brief Cron 상세 스레드 발송 실패 — 요약만 전달됨: ${formatError(error)}`,
        );
      }
    }
    this.logger.log(`Study Brief Cron 발송 완료 — target=${target}`);
  }

  private notifyOwnerFailure(ownerSlackUserId: string, error: unknown): void {
    if (!this.notificationPublisher) {
      return;
    }
    this.notificationPublisher.publishCronFailure({
      cronName: 'Study Brief Cron',
      ownerSlackUserId,
      errorMessage: formatError(error),
    });
  }
}

const calculateKindBalance = (
  recentBriefs: readonly RecentStudyBrief[],
): StudyKindBalance => {
  const balance: StudyKindBalance = { CONCEPT: 0, TOOL: 0 };
  for (const brief of recentBriefs.slice(0, KIND_BALANCE_LIMIT)) {
    balance[brief.kind] += 1;
  }
  return balance;
};

const isSkippedResearch = (
  research: StudyResearchResult | StudyResearchSkipped,
): research is StudyResearchSkipped => 'skippedReason' in research;

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
