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

// 최근 48시간 안의 브리프만 대상으로 한다. 오래된 것까지 거슬러 올라가면 지난 30일치가 큐에
// 밀려들어 블로그에 오르는 글과 그날 Slack 으로 본 주제가 어긋난다. 24시간이 아니라 48시간인
// 이유는 실패 구제다 — Hermes 가 한 번 죽으면 그 브리프는 다시는 후보에 오르지 않는다.
// 정렬이 최신순이라 평소에는 늘 그날 아침 브리프가 잡히고, 어제 실패분은 그 다음이다.
const LOOKBACK_MS = 48 * 60 * 60 * 1_000;

export interface ExpandStudyBriefInput {
  ownerSlackUserId: string;
  triggerType?: TriggerType;
  firedAtKst?: string;
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
        const brief = await this.studyBriefRepository.findLatestUnexpandedSince(
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
      },
    });
  }

  // 표시가 실패하면 다음 회차가 같은 브리프를 다시 확장한다 — 제목이 같으면
  // findOrCreateDailyPage 가 같은 페이지를 돌려주므로 본문이 두 번 붙는다. 실패를 삼키지 않되,
  // **이미 만들어진 페이지 주소를 로그에 남긴다**: 그러지 않으면 사용자가 무엇을 지워야 하는지
  // 알 수 없다(원장에는 실패만 남고 page id 는 어디에도 없다).
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

  private async createDraftPage(
    databaseId: string,
    draft: { title: string; tags: string[]; bodyMd: string },
  ): Promise<{ pageId: string; url: string }> {
    // 제목 속성명은 DB 마다 다르다 — findOrCreateDailyPage 가 스키마에서 title 타입 속성을
    // 찾아 쓰므로 여기서 이름을 가정하지 않는다(저녁 회고 applier 와 같은 경로).
    const page = await this.notionClient.findOrCreateDailyPage({
      databaseId,
      title: draft.title,
    });
    // appendBlocks 가 100개 단위 chunk 를 알아서 나눈다. 딥다이브 본문은 수백 block 이 된다.
    await this.notionClient.appendBlocks({
      pageId: page.pageId,
      blocks: markdownToBlocks(draft.bodyMd),
    });
    await this.applyRowProperties(page.pageId, draft.tags);
    return { pageId: page.pageId, url: page.url };
  }

  // 본문은 이미 저장된 뒤라 throw 하지 않는다. 다만 상태가 '초안' 으로 안 찍히면 발행 라인이
  // 이 글을 영영 집지 않으므로, 조용히 넘기지 않고 error 로그로 남긴다.
  private async applyRowProperties(
    pageId: string,
    tags: string[],
  ): Promise<void> {
    try {
      await this.notionClient.updatePageProperties({
        pageId,
        properties: buildStudyDeepdiveBlogProperties(tags),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `딥다이브 초안 속성(상태/출처유형/카테고리/태그) 설정 실패 — 발행 후보에 잡히지 않습니다. Notion 에서 직접 채워주세요 (page=${pageId}): ${message}`,
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
