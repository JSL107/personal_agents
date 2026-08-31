import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { StudyTopicVerdict } from '../../agent/cto/domain/cto.type';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import {
  NOTION_FILE_UPLOAD_PORT,
  NotionFileUploadPort,
} from '../../notion/domain/port/notion-file-upload.port';
import {
  GenerateStudyDiagramInput,
  GenerateStudyDiagramUsecase,
} from '../application/generate-study-diagram.usecase';
import {
  INSTALLED_TOOLS_PORT,
  InstalledToolsPort,
} from '../domain/port/installed-tools.port';
import {
  REPO_CONTEXT_PORT,
  RepoContextPort,
  RepoModuleSummary,
} from '../domain/port/repo-context.port';
import {
  RecentStudyBrief,
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import {
  PublishedStudyBrief,
  PublishStudyBriefInput,
  STUDY_BRIEF_PUBLISHER_PORT,
  StudyBriefPublisherPort,
} from '../domain/port/study-brief-publisher.port';
import { StudyBriefException } from '../domain/study-brief.exception';
import { StudyBriefVerdict } from '../domain/study-brief.type';
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
const REPORT_WARNING_LENGTH = 3_000;

interface StudyMaterials {
  profile: CareerProfileSnapshot | undefined;
  recentBriefs: RecentStudyBrief[];
  installedTools: string[];
  repoModules: RepoModuleSummary[];
}

interface DeliverStudyBriefInput {
  target: string;
  topic: string;
  summary: string;
  detail?: string;
  guardKey: string;
}

interface PublishToNotionInput {
  briefId: number;
  research: StudyResearchResult;
  verdict: StudyBriefVerdict;
  diagramFileUploadId?: string;
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
    @Inject(REPO_CONTEXT_PORT)
    private readonly repoContext: RepoContextPort,
    @Inject(STUDY_BRIEF_PUBLISHER_PORT)
    private readonly studyBriefPublisher: StudyBriefPublisherPort,
    private readonly generateStudyDiagram: GenerateStudyDiagramUsecase,
    @Inject(NOTION_FILE_UPLOAD_PORT)
    private readonly notionFileUpload: NotionFileUploadPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<StudyBriefCronJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    const dateKey = getTodayKstDate();
    // owner 를 키에 포함 — 잡은 owner 별로 등록되므로(scheduler jobId 참조),
    // owner 가 빠지면 한 owner 의 발송이 같은 날 다른 owner 전원을 막는다.
    const guardKey = `cron:${STUDY_BRIEF_CRON_QUEUE}:${ownerSlackUserId}:${dateKey}`;
    const processingGuardKey = `${guardKey}:processing`;
    let ownsProcessingGuard = false;
    // CTO 판정(EvaluateStudyTopicUsecase)이 자체 AgentRun 을 남기므로, 그 지점에 **진입했는지**
    // 기억해 실패 기록이 겹치지 않게 한다. 성공 시점에 표시하면 판정 자체가 실패했을 때
    // (판정 usecase 가 이미 FAILED 로 마감한 뒤 throw) 여기서 또 남겨 실패가 두 번 세어진다.
    let verdictAttempted = false;
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
      if (research.reportMd.length > REPORT_WARNING_LENGTH) {
        this.logger.warn(
          `Study Brief 조사 본문 3,000자 초과 — prompt 분량 계약 확인 필요: ${research.reportMd.length}자`,
        );
      }

      verdictAttempted = true;
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
        repoModules: materials.repoModules.map((module) => ({ ...module })),
      });
      const verdict = toStudyBriefVerdict(outcome.result);
      const saved = await this.studyBriefRepository.save({
        agentRunId: outcome.agentRunId,
        ownerUserId: ownerSlackUserId,
        kind: research.kind,
        topic: research.topic,
        verdict,
        reportMd: research.reportMd,
        sourceUrls: research.sourceUrls,
      });
      // 노션 발행 대상이 없는 Slack-only 구성에서는 그림을 만들 이유가 없다 — 어차피
      // publishToNotionOrNull() 이 결과를 버린다. codex 를 최대 두 번 돌리고 파일까지
      // 올린 뒤 버리는 매일 반복되는 낭비를 막는다(codex 는 구독 쿼터를 쓴다).
      const diagramFileUploadId = this.resolveNotionDatabaseId()
        ? await this.buildDiagramOrNull({
            topic: research.topic,
            kind: research.kind,
            reportMd: research.reportMd,
          })
        : null;
      const published = await this.publishToNotionOrNull({
        briefId: saved.id,
        research,
        verdict,
        ...(diagramFileUploadId ? { diagramFileUploadId } : {}),
      });

      const rendered = formatStudyBrief({
        mode: published ? 'link' : 'fallback',
        notionUrl: published?.url,
        topic: research.topic,
        verdict,
        reportMd: research.reportMd,
      });
      if (rendered.summaryFallback) {
        this.logger.warn(
          'Study Brief 세 줄 요약 heading 없음 — 본문 첫 문단으로 대체',
        );
      }
      await this.deliverOnce({
        target,
        topic: research.topic,
        summary: rendered.summary,
        ...(published ? {} : { detail: rendered.full }),
        guardKey,
      });
    } catch (error) {
      this.logger.error(
        `Study Brief Cron 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      if (!verdictAttempted) {
        await this.recordPreVerdictFailure(ownerSlackUserId, error);
      }
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
    const [profile, recentBriefs, installedTools, repoModules] =
      await Promise.all([
        this.collectProfile(ownerSlackUserId),
        this.collectRecentBriefs(ownerSlackUserId),
        this.collectInstalledTools(),
        this.collectRepoModules(),
      ]);
    return { profile, recentBriefs, installedTools, repoModules };
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

  private async collectRepoModules(): Promise<RepoModuleSummary[]> {
    try {
      return await this.repoContext.collect();
    } catch (error) {
      this.logger.warn(
        `Study Brief 레포 모듈 수집 실패 — 빈 목록으로 진행: ${formatError(error)}`,
      );
      return [];
    }
  }

  private async publishToNotionOrNull({
    briefId,
    research,
    verdict,
    diagramFileUploadId,
  }: PublishToNotionInput): Promise<PublishedStudyBrief | null> {
    if (!this.resolveNotionDatabaseId()) {
      return null;
    }
    const publishInput: PublishStudyBriefInput = {
      kind: research.kind,
      topic: research.topic,
      verdict,
      reportMd: research.reportMd,
      sourceUrls: research.sourceUrls,
      createdAt: new Date(),
    };
    const published = await this.publishWithDiagramFallback(
      publishInput,
      diagramFileUploadId,
    );
    if (published === null) {
      return null;
    }

    try {
      await this.studyBriefRepository.updateNotionUrl(briefId, published.url);
    } catch (error) {
      this.logger.warn(
        `Study Brief Notion URL 저장 실패 — 링크 발송은 유지: ${formatError(error)}`,
      );
    }
    return published;
  }

  // 그림을 포함한 발행이 실패하면 그림 없이 한 번 재발행한다. 그림 블록은 콜아웃·본문·출처와
  // 같은 createDatabasePage() 요청에 실려 나가므로, 첨부 하나(만료·거부)가 실패하면 원래
  // 잘 만들어지던 텍스트 페이지까지 통째로 사라진다 — "그림은 있으면 좋은 것이지 발행을
  // 막을 이유가 아니다" 라는 전제와 어긋나는 회귀다. diagramFileUploadId 가 애초에 없었다면
  // 재발행하지 않는다(같은 요청을 두 번 보내는 셈이다).
  private async publishWithDiagramFallback(
    input: PublishStudyBriefInput,
    diagramFileUploadId: string | undefined,
  ): Promise<PublishedStudyBrief | null> {
    try {
      return await this.studyBriefPublisher.publish({
        ...input,
        ...(diagramFileUploadId ? { diagramFileUploadId } : {}),
      });
    } catch (error) {
      this.logger.warn(
        `Study Brief Notion 페이지 발행 실패 — Slack 전체 카드로 대체: ${formatError(error)}`,
      );
      if (diagramFileUploadId === undefined) {
        return null;
      }
    }

    try {
      const published = await this.studyBriefPublisher.publish(input);
      this.logger.warn(
        'Study Brief Notion 그림 없이 재발행 성공 — 그림 첨부 단계만 실패했을 가능성이 높습니다.',
      );
      return published;
    } catch (retryError) {
      this.logger.warn(
        `Study Brief Notion 그림 없는 재발행도 실패 — Slack 전체 카드로 대체: ${formatError(retryError)}`,
      );
      return null;
    }
  }

  // 두 곳(그림 생성 진입 전, 발행 대상 확인)이 같은 설정을 따로 읽으면 한쪽만 고쳐지는
  // 사고가 난다 — 작은 헬퍼로 묶어 둘이 항상 같은 판단을 쓰게 한다.
  private resolveNotionDatabaseId(): string | undefined {
    return this.configService
      .get<string>('STUDY_BRIEF_NOTION_DATABASE_ID')
      ?.trim();
  }

  // 그림은 있으면 좋은 것이지 발행을 막을 이유가 아니다.
  // 여기서 나오는 모든 실패는 삼키고, 왜 삼켰는지만 남긴다.
  private async buildDiagramOrNull(
    input: GenerateStudyDiagramInput,
  ): Promise<string | null> {
    try {
      const diagram = await this.generateStudyDiagram.execute(input);
      if (diagram === null) {
        return null;
      }
      return await this.notionFileUpload.uploadImage({
        filename: buildDiagramFilename(input.topic),
        png: diagram.png,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Study 그림 첨부 실패 — 그림 없이 발행합니다: ${formatError(error)}`,
      );
      return null;
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

    if (threadTs && detail !== undefined) {
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

  /**
   * CTO 판정 전(소재 수집·Hermes 리서치)에 죽은 실행을 원장에 FAILED 한 줄로 남긴다.
   *
   * 이 구간의 실패는 `EvaluateStudyTopicUsecase` 가 AgentRun 을 만들기 **전에** 일어나
   * 지금까지 원장에 아무 흔적도 남기지 않았다. Slack 통지는 가지만, 실패율·소요시간·재시도를
   * 보는 유일한 원장에서는 "그날 실패한 것" 과 "아예 발화하지 않은 것" 이 똑같이 빈칸이라
   * 며칠 연속 죽어도 계측에 잡히지 않는다(실제로 Hermes 인증 만료로 이틀치가 그렇게 사라졌다).
   *
   * 기록 자체가 목적이므로 여기서 다시 던지지 않는다 — 호출부가 원래 에러를 그대로 던진다.
   */
  private async recordPreVerdictFailure(
    ownerSlackUserId: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.agentRunService.execute({
        agentType: AgentType.CTO_STUDY,
        triggerType: TriggerType.STUDY_BRIEF_CRON,
        // 키 이름은 slackUserId 로 고정한다 — 사용자 한정 원장 집계가 이 JSON path 만 본다.
        // ownerSlackUserId 로 남기면 전역 실패율에는 잡히면서 `/quota` 같은 사용자별
        // 표면에서만 빠져, 같은 CTO_STUDY 실행끼리 집계 범위가 달라진다.
        inputSnapshot: { slackUserId: ownerSlackUserId, stage: 'research' },
        run: () => Promise.reject(error),
      });
    } catch {
      // execute 는 FAILED 로 마감한 뒤 같은 에러를 다시 던진다. 원장에 남기는 것이 목적이라 삼킨다.
    }
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

const toStudyBriefVerdict = (verdict: StudyTopicVerdict): StudyBriefVerdict => {
  if (verdict.kind === 'CONCEPT') {
    return {
      kind: verdict.kind,
      whyNow: verdict.whyNow,
      whereItLands: verdict.whereItLands,
      minutes: verdict.minutes,
    };
  }
  return {
    kind: verdict.kind,
    whatImproves: verdict.whatImproves,
    adoptionCost: verdict.adoptionCost,
    ...(verdict.caution === undefined ? {} : { caution: verdict.caution }),
    minutes: verdict.minutes,
  };
};

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

const buildDiagramFilename = (topic: string): string => {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'study'}-diagram.png`;
};

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
