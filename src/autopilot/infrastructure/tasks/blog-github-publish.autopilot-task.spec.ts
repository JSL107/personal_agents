import { ConfigService } from '@nestjs/config';

import { PublishNotionDraftUsecase } from '../../../agent/blog/application/publish-notion-draft.usecase';
import { BlogPublishCandidate } from '../../../agent/blog/domain/blog.type';
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
}) => {
  const publishNotionDraft = {
    buildPublishCandidate: jest.fn().mockResolvedValue({
      candidate: options.candidate ?? READY_CANDIDATE,
      modelUsed: 'codex-cli',
    }),
  } as unknown as jest.Mocked<PublishNotionDraftUsecase>;
  // 실제 AgentRunService 처럼 run() 을 실행해 결과를 그대로 돌려준다.
  const agentRunService = {
    execute: jest.fn().mockImplementation(async (input) => {
      const execution = await input.run({ agentRunId: 91 });
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
  };
};

describe('BlogGithubPublishAutopilotTask', () => {
  it('BLOG_GITHUB_PUBLISH_ENABLED=false이면 후보를 만들지 않고 skip한다', async () => {
    const { task, publishNotionDraft } = buildTask({ enabled: 'false' });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
    expect(publishNotionDraft.buildPublishCandidate).not.toHaveBeenCalled();
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

  it('기본 ON에서 준비된 후보를 orchestrator용 단수 preview로 반환한다', async () => {
    const { task } = buildTask({});

    const result = await task.run(CONTEXT);

    expect(result).toEqual({
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
