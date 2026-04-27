import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { NotionClientPort } from '../../../notion/domain/port/notion-client.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { TaskItem } from '../domain/pm-agent.type';
import {
  PmWriteBackApplier,
  PmWriteBackPayload,
} from './pm-write-back.applier';

const buildTask = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? 'foo/bar#34',
  title: overrides.title ?? 'PR #34 — review',
  source: overrides.source ?? 'GITHUB',
  subtasks: overrides.subtasks ?? [
    { title: 'sub 1', estimatedMinutes: 30 },
    { title: 'sub 2', estimatedMinutes: 45 },
  ],
  isCriticalPath: overrides.isCriticalPath ?? false,
});

const buildPreview = (payload: PmWriteBackPayload): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PM_WRITE_BACK,
  payload,
  status: PREVIEW_STATUS.PENDING,
  previewText: 'preview',
  responseUrl: null,
  expiresAt: new Date('2026-04-27T13:00:00.000Z'),
  createdAt: new Date('2026-04-27T11:00:00.000Z'),
  appliedAt: null,
  cancelledAt: null,
});

const buildGithubMock = (): jest.Mocked<GithubClientPort> => ({
  listMyAssignedTasks: jest.fn(),
  getPullRequest: jest.fn(),
  getPullRequestDiff: jest.fn(),
  addIssueComment: jest.fn().mockResolvedValue(undefined),
});

const buildNotionMock = (): jest.Mocked<NotionClientPort> => ({
  listActiveTasks: jest.fn(),
  findOrCreateDailyPage: jest.fn(),
  appendBlocks: jest.fn().mockResolvedValue(undefined),
});

describe('PmWriteBackApplier', () => {
  it('GITHUB task 의 코멘트 추가 호출 — repo/number 가 task.id 에서 파싱', async () => {
    const github = buildGithubMock();
    const notion = buildNotionMock();
    const applier = new PmWriteBackApplier(github, notion);
    const preview = buildPreview({
      tasks: [buildTask({ id: 'foo/bar#34', source: 'GITHUB' })],
    });

    const result = await applier.apply(preview);

    expect(github.addIssueComment).toHaveBeenCalledWith({
      repo: 'foo/bar',
      number: 34,
      body: expect.stringContaining('sub 1'),
    });
    expect(github.addIssueComment.mock.calls[0][0].body).toContain(
      '🤖 *이대리 PM 동기화',
    );
    expect(result).toContain('GitHub 1개');
    expect(result).toContain('Notion 0개');
  });

  it('NOTION task 의 page 에 todo blocks append', async () => {
    const github = buildGithubMock();
    const notion = buildNotionMock();
    const applier = new PmWriteBackApplier(github, notion);
    const preview = buildPreview({
      tasks: [
        buildTask({
          id: 'page-abc',
          source: 'NOTION',
          subtasks: [{ title: 'subA', estimatedMinutes: 60 }],
        }),
      ],
    });

    const result = await applier.apply(preview);

    expect(notion.appendBlocks).toHaveBeenCalledWith({
      pageId: 'page-abc',
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: 'subheading' }),
        expect.objectContaining({
          type: 'todo',
          text: 'subA (60m)',
        }),
      ]),
    });
    expect(result).toContain('Notion 1개');
  });

  it('subtasks 가 비어있는 task 는 skip', async () => {
    const github = buildGithubMock();
    const notion = buildNotionMock();
    const applier = new PmWriteBackApplier(github, notion);
    const preview = buildPreview({
      tasks: [buildTask({ id: 'foo/bar#1', source: 'GITHUB', subtasks: [] })],
    });

    const result = await applier.apply(preview);

    expect(github.addIssueComment).not.toHaveBeenCalled();
    expect(result).toContain('GitHub 0개');
  });

  it('한 task 의 외부 호출 실패가 다른 task 적용을 막지 않음 (graceful)', async () => {
    const github = buildGithubMock();
    const notion = buildNotionMock();
    github.addIssueComment.mockRejectedValueOnce(new Error('GitHub down'));
    const applier = new PmWriteBackApplier(github, notion);

    const preview = buildPreview({
      tasks: [
        buildTask({ id: 'foo/bar#1', source: 'GITHUB' }),
        buildTask({ id: 'foo/bar#2', source: 'GITHUB' }),
      ],
    });

    const result = await applier.apply(preview);

    expect(github.addIssueComment).toHaveBeenCalledTimes(2);
    // 첫 번째 실패 → 1개만 카운트.
    expect(result).toContain('GitHub 1개');
  });

  it('payload.tasks 가 누락되면 명시 예외', async () => {
    const applier = new PmWriteBackApplier(
      buildGithubMock(),
      buildNotionMock(),
    );
    const preview = {
      ...buildPreview({ tasks: [] }),
      payload: {} as unknown,
    } as PreviewAction;

    await expect(applier.apply(preview)).rejects.toThrow(
      'PmWriteBackPayload.tasks',
    );
  });

  it('GITHUB task.id 가 owner/repo#number 형식 아니면 명시 예외', async () => {
    const github = buildGithubMock();
    const applier = new PmWriteBackApplier(github, buildNotionMock());
    const preview = buildPreview({
      tasks: [buildTask({ id: 'invalid-id', source: 'GITHUB' })],
    });

    // 한 task 실패는 graceful 이라 throw 안 함, 카운트만 0.
    const result = await applier.apply(preview);
    expect(result).toContain('GitHub 0개');
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });
});
