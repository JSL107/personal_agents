import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { BLOG_PROMPT_FILE } from '../domain/blog-editable-surface';
import { ProposalTarget } from '../domain/humanize-research.type';
import { CANON_RULES_FILE } from '../domain/proposal-gate';
import { CanonCheckRunner } from './canon-check.runner';
import { HumanizeRulePrApplier } from './humanize-rule-pr.applier';

const CANON_ROW =
  '| A-8 | 이중 피동 "~되어진다" | S1 | 능동 또는 단일 피동 ("판단되어진다" → "판단된다") |';
const BLOG_TEXT =
  '  - 이중 피동 "~되어진다/~보여진다" → 단일 피동("판단된다") 또는 능동';
const RULE_LINKS_FILE = 'src/humanize/domain/humanize-rule-links.ts';

const makePreview = (target: ProposalTarget): PreviewAction => ({
  id: 'preview-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.HUMANIZE_RULE_PR,
  payload: {
    target,
    repo:
      target === ProposalTarget.CANON
        ? 'JSL107/humanize-korean'
        : 'JSL107/personal_agents',
    baseBranch: 'main',
    baseSha: target === ProposalTarget.CANON ? 'base-sha' : null,
    file: target === ProposalTarget.CANON ? CANON_RULES_FILE : BLOG_PROMPT_FILE,
    oldString: target === ProposalTarget.CANON ? CANON_ROW : BLOG_TEXT,
    newString: '새 문구',
    rationale: '근거',
    targetMetric: '중복 피동 감소',
    evidence: ['canon:abc'],
    evidenceExcerpts: ['실제 근거 발췌'],
    linkedBlogText: target === ProposalTarget.CANON ? BLOG_TEXT : null,
  },
  status: PREVIEW_STATUS.PENDING,
  previewText: '미리보기',
  expiresAt: new Date('2026-11-17'),
  createdAt: new Date('2026-11-16'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  slackThreadTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
});

describe('HumanizeRulePrApplier', () => {
  const getFileFromBranch = jest.fn();
  const pushBranchAndOpenPr = jest.fn();
  const check = jest.fn();
  const githubClient = {
    getFileFromBranch,
    pushBranchAndOpenPr,
  } as unknown as GithubClientPort;
  const runner = { check } as unknown as CanonCheckRunner;
  const applier = new HumanizeRulePrApplier(githubClient, runner);

  beforeEach(() => {
    jest.clearAllMocks();
    getFileFromBranch.mockImplementation(async ({ path }) => ({
      fileUrl: path,
      content: path === CANON_RULES_FILE ? CANON_ROW : BLOG_TEXT,
    }));
    check.mockResolvedValue({ reason: null, baseSha: 'base-sha' });
    pushBranchAndOpenPr.mockResolvedValue({
      prUrl: 'https://github.com/x/pull/1',
      prNumber: 1,
    });
  });

  it('대상 파일에서 oldString 이 1회가 아니면 PR 을 열지 않고 STALE_PROPOSAL 메시지로 throw 한다', async () => {
    getFileFromBranch.mockResolvedValue({
      content: `${CANON_ROW}\n${CANON_ROW}`,
    });
    await expect(
      applier.apply(makePreview(ProposalTarget.CANON)),
    ).rejects.toThrow('STALE_PROPOSAL:');
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('content 가 없으면 본문을 못 받았다는 메시지로 throw 한다', async () => {
    getFileFromBranch.mockResolvedValue({ fileUrl: 'x' });
    await expect(
      applier.apply(makePreview(ProposalTarget.CANON)),
    ).rejects.toThrow('본문을 받지 못했습니다');
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('canon 검사 SHA 의 본문과 main 본문이 다르면 PR 을 열지 않는다', async () => {
    getFileFromBranch.mockImplementation(async ({ branch }) => {
      const content =
        branch === 'base-sha' ? CANON_ROW : `${CANON_ROW}\n추가 규칙`;
      return { fileUrl: CANON_RULES_FILE, content };
    });
    await expect(
      applier.apply(makePreview(ProposalTarget.CANON)),
    ).rejects.toThrow(
      `STALE_PROPOSAL: ${CANON_RULES_FILE} 가 검사 이후 main 에서 바뀌었습니다`,
    );
    expect(getFileFromBranch).toHaveBeenCalledWith({
      repo: 'JSL107/humanize-korean',
      branch: 'base-sha',
      path: CANON_RULES_FILE,
    });
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('canon 검사 SHA 와 main 본문이 같으면 그 본문으로 PR 을 연다', async () => {
    check.mockResolvedValue({ reason: null, baseSha: 'checked-sha' });
    await applier.apply(makePreview(ProposalTarget.CANON));
    expect(getFileFromBranch).toHaveBeenCalledWith({
      repo: 'JSL107/humanize-korean',
      branch: 'checked-sha',
      path: CANON_RULES_FILE,
    });
    expect(getFileFromBranch).toHaveBeenCalledWith({
      repo: 'JSL107/humanize-korean',
      branch: 'main',
      path: CANON_RULES_FILE,
    });
    expect(pushBranchAndOpenPr).toHaveBeenCalledTimes(1);
  });

  it('canon 검사 SHA 본문이 없으면 PR 을 열지 않는다', async () => {
    getFileFromBranch.mockImplementation(async ({ branch }) => ({
      fileUrl: CANON_RULES_FILE,
      content: branch === 'base-sha' ? undefined : CANON_ROW,
    }));
    await expect(
      applier.apply(makePreview(ProposalTarget.CANON)),
    ).rejects.toThrow('본문을 받지 못했습니다');
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('canon 은 승인 시 CanonCheckRunner 를 다시 돌리고 실패하면 throw 한다', async () => {
    check.mockResolvedValue({
      reason: 'SELFCHECK_FAILED',
      baseSha: 'base-sha',
    });
    await expect(
      applier.apply(makePreview(ProposalTarget.CANON)),
    ).rejects.toThrow('정본 검사 실패: SELFCHECK_FAILED');
    expect(check).toHaveBeenCalledTimes(1);
    expect(getFileFromBranch).not.toHaveBeenCalled();
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('canon 검사는 GitHub 파일 조회보다 먼저 끝난다', async () => {
    await applier.apply(makePreview(ProposalTarget.CANON));
    const checkOrder = check.mock.invocationCallOrder[0];
    const fileOrder = getFileFromBranch.mock.invocationCallOrder[0];
    const pushOrder = pushBranchAndOpenPr.mock.invocationCallOrder[0];
    expect(checkOrder).toBeLessThan(fileOrder);
    expect(fileOrder).toBeLessThan(pushOrder);
  });

  it('canon 재검사 자체가 실패하면 PR 을 열지 않는다', async () => {
    check.mockRejectedValue(new Error('fetch failed'));
    await expect(
      applier.apply(makePreview(ProposalTarget.CANON)),
    ).rejects.toThrow('fetch failed');
    expect(getFileFromBranch).not.toHaveBeenCalled();
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('blog 는 프롬프트 파일과 humanize-rule-links.ts 두 파일을 한 커밋으로 연다', async () => {
    await applier.apply(makePreview(ProposalTarget.BLOG));
    expect(getFileFromBranch).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents',
      branch: 'main',
      path: RULE_LINKS_FILE,
    });
    expect(pushBranchAndOpenPr).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          { path: BLOG_PROMPT_FILE, content: '새 문구' },
          { path: RULE_LINKS_FILE, content: '새 문구' },
        ],
      }),
    );
  });

  it('공개 blog PR 본문에는 증거 ID 만 싣고 비공개 발췌는 빼며 canon 본문은 발췌를 싣는다', async () => {
    const blogPreview = makePreview(ProposalTarget.BLOG);
    const blogPayload = blogPreview.payload as Record<string, unknown>;
    blogPayload.evidenceExcerpts = [
      '비공개 근거 첫째: 실제 근거 발췌',
      '비공개 근거 둘째: 원문은 외부 공개 금지',
    ];
    await applier.apply(blogPreview);
    const blogBody = pushBranchAndOpenPr.mock.calls[0][0].prBody;
    expect(blogBody).toContain('canon:abc');
    expect(blogBody).toContain('공개 저장소');
    for (const excerpt of blogPayload.evidenceExcerpts as string[]) {
      expect(blogBody).not.toContain(excerpt);
    }

    const canonPreview = makePreview(ProposalTarget.CANON);
    const canonPayload = canonPreview.payload as Record<string, unknown>;
    canonPayload.evidenceExcerpts = blogPayload.evidenceExcerpts;
    await applier.apply(canonPreview);
    const canonBody = pushBranchAndOpenPr.mock.calls[1][0].prBody;
    for (const excerpt of canonPayload.evidenceExcerpts as string[]) {
      expect(canonBody).toContain(excerpt);
    }
  });

  it('blog 문구에 위험 문자가 있으면 GitHub 호출 전에 거절한다', async () => {
    for (const field of ['oldString', 'newString']) {
      const preview = makePreview(ProposalTarget.BLOG);
      const payload = preview.payload as Record<string, unknown>;
      payload[field] = '${value}';
      await expect(applier.apply(preview)).rejects.toThrow(
        'UNSAFE_BLOG_LITERAL',
      );
      expect(getFileFromBranch).not.toHaveBeenCalled();
      expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
    }
  });

  it('blog 연결표 문구가 달라졌으면 PR 을 열지 않는다', async () => {
    getFileFromBranch.mockImplementation(async ({ path }) => {
      const content = path === RULE_LINKS_FILE ? '다른 문구' : BLOG_TEXT;
      return { fileUrl: path, content };
    });
    await expect(
      applier.apply(makePreview(ProposalTarget.BLOG)),
    ).rejects.toThrow(`STALE_PROPOSAL: ${RULE_LINKS_FILE}`);
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('성공 시 artifacts 에 github_pr 을 반환하고 assignees 에 JSL107 을 넣는다', async () => {
    const result = await applier.apply(makePreview(ProposalTarget.CANON));
    expect(result.artifacts).toEqual([
      { type: 'github_pr', repo: 'JSL107/humanize-korean', prNumber: 1 },
    ]);
    expect(pushBranchAndOpenPr).toHaveBeenCalledWith(
      expect.objectContaining({ assignees: ['JSL107'] }),
    );
  });

  it('긴 PR 본문에서도 4000자 상한과 사람 검토 문구를 지킨다', async () => {
    const preview = makePreview(ProposalTarget.CANON);
    const payload = preview.payload as Record<string, unknown>;
    payload.rationale = '근거'.repeat(3_000);
    await applier.apply(preview);
    const call = pushBranchAndOpenPr.mock.calls[0][0];
    expect(call.prBody.length).toBeLessThanOrEqual(4_000);
    expect(call.prBody).toContain('머지 전 사람 검토 필수');
  });

  it('newString 의 달러 표기를 치환 연산으로 해석하지 않는다', async () => {
    const preview = makePreview(ProposalTarget.CANON);
    const payload = preview.payload as Record<string, unknown>;
    payload.newString = '$&';
    await applier.apply(preview);
    const call = pushBranchAndOpenPr.mock.calls[0][0];
    expect(call.files[0].content).toBe('$&');
  });

  it('resumable 은 정의하지 않는다', () => {
    expect('resumable' in applier).toBe(false);
  });

  it('payload 형식이 틀리면 throw 한다', async () => {
    const preview = makePreview(ProposalTarget.CANON);
    preview.payload = { target: 'bad' };
    await expect(applier.apply(preview)).rejects.toThrow('payload');
    expect(pushBranchAndOpenPr).not.toHaveBeenCalled();
  });
});
