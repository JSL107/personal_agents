import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../../agent/blog/domain/port/hermes-runner.port';
import { buildStudyDeepdiveBlogProperties } from '../../agent/blog/domain/study-deepdive-blog-properties';
import {
  AgentRunOutcome,
  AgentRunService,
} from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../notion/domain/port/notion-client.port';
import { markdownToBlocks } from '../../notion/infrastructure/markdown-to-blocks';
import {
  REPO_CONTEXT_PORT,
  RepoContextPort,
} from '../domain/port/repo-context.port';
import {
  ExpandableStudyBrief,
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import { parseStudyDeepdive } from '../domain/study-deepdive.parser';
import { buildStudyDeepdivePrompt } from '../domain/study-deepdive.prompt';

// 최근 48시간 안의 브리프만 대상으로 한다. 창을 넓히면 지난 30일치가 큐에 밀려들어 블로그에
// 오르는 글과 그날 Slack 으로 본 주제가 어긋난다. 24시간이 아니라 48시간인 이유는 실패 구제다 —
// Hermes 가 한 번 죽어도 다음 회차가 그 브리프를 집을 수 있어야 한다(그래서 조회도 오래된 것부터).
const LOOKBACK_MS = 48 * 60 * 60 * 1_000;

// Notion pages.create 는 한 요청에 child 100개까지 받는다(그 이상은 클라이언트가 잘라낸다).
// 넘치는 만큼은 append 로 잇는다 — 6,000자 본문은 이 한도를 넘길 수 있다.
const NOTION_FIRST_REQUEST_BLOCK_LIMIT = 100;

// Hermes 최악 12분 + Notion 적재를 덮는 폭.
const PROCESSING_GUARD_TTL_SECONDS = 20 * 60;
const PROCESSING_GUARD_KEY = 'study-deepdive:expanding';

export interface ExpandStudyBriefInput {
  ownerSlackUserId: string;
  triggerType?: TriggerType;
  firedAtKst?: string;
}

// AgentRunService.run 이 돌려줘야 하는 형태. 인라인으로 쓰면 반환 타입이 세 곳에서 갈린다.
interface ExpandStudyBriefExecution {
  result: ExpandStudyBriefResult;
  modelUsed: string;
  output: ExpandStudyBriefResult;
}

export type ExpandStudyBriefResult =
  | { status: 'empty'; message: string }
  | {
      status: 'created';
      briefId: number;
      topic: string;
      title: string;
      tags: string[];
      bodyLength: number;
      notionUrl: string;
    };

// 오늘의 공부(압축 요약) → 블로그 초안(딥다이브 원고).
//
// 여기서 만드는 것은 **초안**이지 발행이 아니다. 익명화·편집·사용자 말투 윤문·금지어 게이트·
// 승인 카드·커밋은 전부 기존 발행 라인(PublishNotionDraftUsecase)이 맡는다. 이 usecase 가
// 하는 일은 "얕은 요약을 다시 조사해 글 길이로 펼쳐 초안 DB 에 놓는 것" 하나다.
@Injectable()
export class ExpandStudyBriefUsecase {
  private readonly logger = new Logger(ExpandStudyBriefUsecase.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
    @Inject(STUDY_BRIEF_REPOSITORY_PORT)
    private readonly studyBriefRepository: StudyBriefRepositoryPort,
    @Inject(REPO_CONTEXT_PORT)
    private readonly repoContext: RepoContextPort,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly configService: ConfigService,
    private readonly cronIdempotency: CronIdempotencyService,
  ) {}

  // 초안 DB 를 설정하지 않은 환경에서 매일 FAILED 를 쌓지 않도록 autopilot task 가 먼저 묻는다
  // (blog-github-publish task 의 isPublishConfigured 와 같은 이유).
  isConfigured(): boolean {
    return this.getDatabaseId() !== undefined;
  }

  async execute(
    input: ExpandStudyBriefInput,
  ): Promise<AgentRunOutcome<ExpandStudyBriefResult>> {
    const databaseId = this.getDatabaseId();
    if (databaseId === undefined) {
      throw new Error(
        'EVENING_RETRO_BLOG_NOTION_DATABASE_ID 가 설정되지 않았습니다 (.env 확인).',
      );
    }

    return this.agentRunService.execute<ExpandStudyBriefResult>({
      // 오늘의 공부 주제를 고르는 판정과 같은 에이전트다 — 학습 라인의 1단계(필요성 판정)와
      // 2단계(글로 펼치기)를 한 사람이 맡는다. 두 실행은 triggerType 으로 갈라 본다
      // (STUDY_BRIEF_CRON = 판정 / AUTOPILOT_STUDY_DEEPDIVE_CRON = 확장).
      //
      // 별도 AgentType 을 두지 않은 이유는 원장이 아니라 오피스 화면이다: 새 AgentType 은
      // 곧 오피스에 사람 한 명이고, 방 정원 10석이 상한이라 성장·내부 어느 방에 앉혀도
      // 가구가 밀리거나 이웃 이름표가 눌린다(실측: 성장 3건 / 내부 1건 실패).
      agentType: AgentType.CTO_STUDY,
      triggerType:
        input.triggerType ?? TriggerType.AUTOPILOT_STUDY_DEEPDIVE_CRON,
      inputSnapshot: {
        slackUserId: input.ownerSlackUserId,
        ...(input.firedAtKst ? { firedAtKst: input.firedAtKst } : {}),
      },
      run: async ({ updateInputSnapshot }) => {
        // 브리프 조회와 확장 완료 표시가 원자적이지 않다. cron(11:00)과 수동 CLI 가 겹치면
        // 같은 브리프를 동시에 확장해 초안이 두 장 만들어지므로 확장 구간 자체를 잠근다.
        const acquired = await this.cronIdempotency.acquireOnce(
          PROCESSING_GUARD_KEY,
          PROCESSING_GUARD_TTL_SECONDS,
        );
        if (!acquired) {
          const result: ExpandStudyBriefResult = {
            status: 'empty',
            message: '다른 딥다이브 확장이 진행 중입니다.',
          };
          return { result, modelUsed: 'deterministic', output: result };
        }
        try {
          return await this.expandOnce(input, databaseId, updateInputSnapshot);
        } finally {
          await this.cronIdempotency.release(PROCESSING_GUARD_KEY);
        }
      },
    });
  }

  private async expandOnce(
    input: ExpandStudyBriefInput,
    databaseId: string,
    updateInputSnapshot: (snapshot: Record<string, unknown>) => Promise<void>,
  ): Promise<ExpandStudyBriefExecution> {
    // 가장 **오래된** 미확장 브리프부터 집는다. 최신순으로 집으면 어제 실패한 브리프가
    // 오늘 브리프에 계속 밀려 48시간 창을 그냥 넘어간다 — 하루 한 번만 도는 작업이라
    // "다음 회차에 처리된다" 는 기회가 오지 않는다.
    const brief = await this.studyBriefRepository.findOldestUnexpandedSince(
      input.ownerSlackUserId,
      new Date(Date.now() - LOOKBACK_MS),
    );
    if (!brief) {
      const result: ExpandStudyBriefResult = {
        status: 'empty',
        message: '확장할 오늘의 공부가 없습니다.',
      };
      return { result, modelUsed: 'deterministic', output: result };
    }
    await updateInputSnapshot({
      slackUserId: input.ownerSlackUserId,
      ...(input.firedAtKst ? { firedAtKst: input.firedAtKst } : {}),
      briefId: brief.id,
      topic: brief.topic,
    });

    const draft = await this.expand(brief);
    const page = await this.createDraftPage(databaseId, draft);
    // 초안 페이지가 만들어진 뒤에 표시한다. 먼저 표시하면 적재가 실패한 브리프가
    // '확장 완료' 로 남아 다시는 후보에 오르지 않는다.
    await this.markExpanded(brief.id, page);

    const result: ExpandStudyBriefResult = {
      status: 'created',
      briefId: brief.id,
      topic: brief.topic,
      title: draft.title,
      tags: draft.tags,
      bodyLength: draft.bodyMd.length,
      notionUrl: page.url,
    };
    return { result, modelUsed: 'hermes-cli', output: result };
  }

  // 표시가 실패하면 다음 회차가 같은 브리프를 다시 확장해 초안이 한 장 더 생긴다. 실패를
  // 삼키지 않되 **이미 만들어진 페이지 주소를 로그에 남긴다**: 그러지 않으면 사용자가 무엇을
  // 지워야 하는지 알 수 없다(원장에는 실패만 남고 page id 는 어디에도 없다).
  private async markExpanded(
    briefId: number,
    page: { pageId: string; url: string },
  ): Promise<void> {
    try {
      await this.studyBriefRepository.markBlogDraftCreated(
        briefId,
        page.pageId,
      );
    } catch (error: unknown) {
      this.logger.error(
        `딥다이브 확장 완료 표시 실패 — 초안은 이미 만들어졌습니다. 다음 회차가 같은 브리프를 다시 확장하면 본문이 중복되므로, 이 페이지를 확인해주세요 (briefId=${briefId}, page=${page.url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  private async expand(brief: ExpandableStudyBrief): Promise<{
    title: string;
    tags: string[];
    bodyMd: string;
  }> {
    const repoModules = await this.repoContext.collect();
    const { stdout } = await this.hermesRunner.run(
      buildStudyDeepdivePrompt({
        kind: brief.kind,
        topic: brief.topic,
        verdict: brief.verdict,
        briefMd: brief.reportMd,
        sourceUrls: brief.sourceUrls,
        repoModules,
      }),
    );
    return parseStudyDeepdive(stdout);
  }

  // 제목이 같은 기존 행을 재사용하지 않는다. findOrCreateDailyPage 는 상태·브리프와 무관하게
  // 제목만으로 행을 돌려주므로, 모델이 과거 글과 같은 제목을 지으면 이미 발행한 글에 새 본문이
  // 덧붙고 상태가 '초안' 으로 되돌아간다.
  //
  // 속성(상태/출처유형/카테고리/태그)은 **생성과 같은 요청에** 실어 보낸다. 뒤이은 별도 갱신으로
  // 두면 그 갱신만 실패했을 때, 발행 조회에 걸리지 않는 글이 '확장 완료' 로 남아 아무도 손대지
  // 않는다 — 자동 경로에는 그 글을 볼 사람이 없다.
  private async createDraftPage(
    databaseId: string,
    draft: { title: string; tags: string[]; bodyMd: string },
  ): Promise<{ pageId: string; url: string }> {
    const blocks = markdownToBlocks(draft.bodyMd);
    const page = await this.notionClient.createDatabasePage({
      databaseId,
      // 제목 속성명은 DB 마다 다르므로 이름을 가정하지 않는다 — 포트가 스키마에서 찾아 넣는다.
      title: draft.title,
      properties: buildStudyDeepdiveBlogProperties(draft.tags),
      blocks,
    });
    if (blocks.length <= NOTION_FIRST_REQUEST_BLOCK_LIMIT) {
      return { pageId: page.pageId, url: page.url };
    }
    try {
      await this.notionClient.appendBlocks({
        pageId: page.pageId,
        blocks: blocks.slice(NOTION_FIRST_REQUEST_BLOCK_LIMIT),
      });
    } catch (appendError: unknown) {
      // 앞부분만 담긴 글을 '초안' 으로 남기면 잘린 글이 그대로 발행 후보가 된다.
      await this.archiveIncompletePage(page.pageId, appendError);
      throw appendError;
    }
    return { pageId: page.pageId, url: page.url };
  }

  private async archiveIncompletePage(
    pageId: string,
    cause: unknown,
  ): Promise<void> {
    this.logger.warn(
      `딥다이브 본문 append 실패 — 불완전 초안 archive 시도 (page=${pageId}): ${formatError(cause)}`,
    );
    try {
      await this.notionClient.archivePage({ pageId });
    } catch (archiveError: unknown) {
      this.logger.warn(
        `딥다이브 불완전 초안 archive 실패 — 수동 정리 필요 (page=${pageId}): ${formatError(archiveError)}`,
      );
    }
  }

  private getDatabaseId(): string | undefined {
    const databaseId = this.configService
      .get<string>('EVENING_RETRO_BLOG_NOTION_DATABASE_ID')
      ?.trim();
    return databaseId ? databaseId : undefined;
  }
}

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
