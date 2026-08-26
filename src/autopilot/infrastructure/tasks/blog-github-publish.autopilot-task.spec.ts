import { ConfigService } from '@nestjs/config';

import { PublishNotionDraftUsecase } from '../../../agent/blog/application/publish-notion-draft.usecase';
import {
  BlogPublishCandidate,
  BlogStageStructure,
} from '../../../agent/blog/domain/blog.type';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { BlogGithubPublishAutopilotTask } from './blog-github-publish.autopilot-task';

const CONTEXT = {
  ownerSlackUserId: 'U1',
  firedAtKst: '2026-08-18',
};

const READY_CANDIDATE: BlogPublishCandidate = {
  status: 'ready',
  payload: {
    pageId: 'page-1',
    path: 'src/content/posts/2026-08-18-safe-post.md',
    content: '---\ntitle: "안전한 글"\n---\n\n본문\n',
    title: '안전한 글',
    notionUrl: 'https://notion.so/page-1',
    tags: ['회고'],
    summary: '안전한 요약',
    slackUserId: 'U1',
  },
  previewText: 'GitHub 블로그 발행 미리보기',
  title: '안전한 글',
  notionUrl: 'https://notion.so/page-1',
  path: 'src/content/posts/2026-08-18-safe-post.md',
  content: '---\ntitle: "안전한 글"\n---\n\n본문\n',
};

const buildTask = (options: {
  enabled?: string;
  candidate?: BlogPublishCandidate;
  configured?: boolean;
  stages?: BlogStageStructure[];
}) => {
  const publishNotionDraft = {
    isPublishConfigured: jest.fn().mockReturnValue(options.configured ?? true),
    buildPublishCandidate: jest.fn().mockResolvedValue({
      candidate: options.candidate ?? READY_CANDIDATE,
      modelUsed: 'codex-cli',
      // 실제 usecase 는 항상 배열을 돌려준다. 목이 이 키를 빼면 형태가 갈려, 배선이 깨져도
      // 초록이 나온다.
      stages: options.stages ?? [],
    }),
  } as unknown as jest.Mocked<PublishNotionDraftUsecase>;
  // 실제 AgentRunService 처럼 run() 을 실행해 결과를 그대로 돌려준다.
  const runOutputs: unknown[] = [];
  const agentRunService = {
    execute: jest.fn().mockImplementation(async (input) => {
      const execution = await input.run({ agentRunId: 91 });
      runOutputs.push(execution.output);
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 91,
      };
    }),
  } as unknown as jest.Mocked<AgentRunService>;
  const config = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'BLOG_GITHUB_PUBLISH_ENABLED' ? options.enabled : undefined,
      ),
  } as unknown as jest.Mocked<ConfigService>;

  return {
    task: new BlogGithubPublishAutopilotTask(
      publishNotionDraft,
      agentRunService,
      config,
    ),
    publishNotionDraft,
    agentRunService,
    runOutputs,
  };
};

describe('BlogGithubPublishAutopilotTask', () => {
  it('BLOG_GITHUB_PUBLISH_ENABLED=false이면 후보를 만들지 않고 skip한다', async () => {
    const { task, publishNotionDraft } = buildTask({ enabled: 'false' });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
    expect(publishNotionDraft.buildPublishCandidate).not.toHaveBeenCalled();
  });

  // .env.example 기본값처럼 블로그 설정이 비어 있는 환경에서 매일 FAILED AgentRun 이
  // 쌓이면 안 된다. 기능을 안 쓰는 환경에서는 없는 것처럼 조용해야 한다.
  it('블로그 발행 설정이 비어 있으면 후보를 만들지 않고 skip한다', async () => {
    const { task, publishNotionDraft, agentRunService } = buildTask({
      configured: false,
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
    expect(publishNotionDraft.buildPublishCandidate).not.toHaveBeenCalled();
    expect(agentRunService.execute).not.toHaveBeenCalled();
  });

  // 보류는 알린다 — 조용히 넘기면 초안이 왜 안 나가는지 사용자가 알 방법이 없다.
  it('편집이 보류로 판정한 회차는 이유를 알린다', async () => {
    const { task } = buildTask({
      candidate: {
        status: 'skipped',
        cause: 'hold',
        message:
          "'강의 정리' 은 발행하지 않고 보류로 옮겼습니다 — 필기 수준이다.",
      },
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({
      skip: false,
      summaryText:
        "'강의 정리' 은 발행하지 않고 보류로 옮겼습니다 — 필기 수준이다.",
    });
  });

  // 카드 대기는 알리지 않는다 — 카드 자체가 이미 신호라 매일 같은 알림이 소음이 된다.
  it('발행 카드가 열려 있는 회차는 조용히 skip한다', async () => {
    const { task } = buildTask({
      candidate: {
        status: 'skipped',
        cause: 'card-open',
        message: '카드가 아직 열려 있습니다.',
      },
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('초안이 없으면 빈 알림 없이 skip한다', async () => {
    const { task, publishNotionDraft } = buildTask({
      candidate: { status: 'empty', message: '발행할 초안이 없습니다.' },
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
    expect(publishNotionDraft.buildPublishCandidate).toHaveBeenCalledWith({
      slackUserId: 'U1',
    });
  });

  it('금지어가 남으면 원문 없는 안내만 반환하고 preview를 만들지 않는다', async () => {
    const safeMessage =
      '익명화 결과에 식별 패턴이 남아 발행을 차단했습니다. Notion에서 수정해주세요. (원문은 실행 기록에만 남깁니다.)';
    const { task } = buildTask({
      candidate: {
        status: 'blocked',
        message: safeMessage,
        hits: [
          {
            term: '비공개회사명',
            kind: 'term',
            excerpt: '유출되면 안 되는 원문',
          },
        ],
      },
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    // 채널에 그대로 게시되는 문자열 — 탐지 원문·매치 문자열이 실려서는 안 된다.
    expect(result.summaryText).not.toContain('비공개회사명');
    expect(result.summaryText).not.toContain('유출되면 안 되는 원문');
    expect(result.preview).toBeUndefined();
  });

  // 실패율·소요시간·쿼터를 보는 도구는 agent_run 하나뿐이라, 기록이 없으면
  // "안 돌았는지 / 돌다 깨졌는지" 가 똑같이 '기록 없음' 으로 보인다.
  it('후보 준비를 AgentRun 으로 기록한다 (원장에 실행·모델·사용자가 남는다)', async () => {
    const { task, agentRunService } = buildTask({});

    await task.run(CONTEXT);

    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'BLOG_PUBLISH',
        triggerType: TriggerType.AUTOPILOT_BLOG_PUBLISH_CRON,
        inputSnapshot: expect.objectContaining({
          taskId: 'blog-github-publish',
          slackUserId: 'U1',
        }),
      }),
    );
  });

  // 공개 저장소에 커밋되는 내용이라, 카드 요약만 보고 ✅ 를 누르면 익명화 실패를 못 잡는다.
  it('실제 커밋될 전문을 스레드(detailText)로 함께 보낸다', async () => {
    const { task } = buildTask({});

    const result = await task.run(CONTEXT);

    expect(result.detailText).toContain(
      'src/content/posts/2026-08-18-safe-post.md',
    );
    // 카드 요약이 아니라 파일 본문이 실려야 한다.
    expect(result.detailText).toContain('본문');
    expect(result.detailText).toContain('title: "안전한 글"');
  });

  it('기본 ON에서 준비된 후보를 orchestrator용 단수 preview로 반환한다', async () => {
    const { task } = buildTask({});

    const result = await task.run(CONTEXT);

    expect(result).toMatchObject({
      skip: false,
      summaryText:
        "Notion 블로그 초안 '안전한 글'의 GitHub 발행 승인을 기다립니다.",
      preview: {
        kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
        payload:
          READY_CANDIDATE.status === 'ready'
            ? READY_CANDIDATE.payload
            : undefined,
        previewText: 'GitHub 블로그 발행 미리보기',
      },
    });
  });
});

// 저녁 발행은 이 task 로만 돈다 — usecase 의 `execute` 는 수동 `/blog-publish` 전용이다.
// 계측을 usecase 쪽에만 넣으면 매일 도는 회차가 통째로 빠진다.
describe('BlogGithubPublishAutopilotTask — 단계 경계 계측', () => {
  it('단계별 구조 수치를 원장 output 에 남긴다', async () => {
    const stages: BlogStageStructure[] = [
      {
        stage: '원문',
        chars: 11_742,
        headings: 18,
        quotes: 7,
        links: 9,
        codeBlocks: 4,
      },
      {
        stage: '익명화',
        chars: 11_623,
        headings: 18,
        quotes: 7,
        links: 9,
        codeBlocks: 4,
      },
      {
        stage: '편집',
        chars: 7_098,
        headings: 9,
        quotes: 0,
        links: 7,
        codeBlocks: 4,
      },
      {
        stage: '최종',
        chars: 7_050,
        headings: 9,
        quotes: 0,
        links: 7,
        codeBlocks: 4,
      },
    ];
    const { task, runOutputs } = buildTask({ stages });

    await task.run(CONTEXT);

    expect(runOutputs[0]).toEqual({ ...READY_CANDIDATE, stages });
  });

  // 빈 배열을 키로 남기면 '재지 않았다' 와 '0 이었다' 가 같은 값이 되어, 원장을 훑는 쪽이
  // 계측 누락을 손실로 읽는다.
  it('잰 단계가 없으면 stages 키를 만들지 않는다', async () => {
    const { task, runOutputs } = buildTask({
      candidate: { status: 'empty', message: '발행할 초안이 없습니다.' },
    });

    await task.run(CONTEXT);

    expect(runOutputs[0]).toEqual({
      status: 'empty',
      message: '발행할 초안이 없습니다.',
    });
  });
});
