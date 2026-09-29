import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { PreviewAction } from '../../preview-gate/domain/preview-action.type';
import { StudyApplyIssueApplier } from './study-apply-issue.applier';

const preview = (payload: unknown): PreviewAction =>
  ({
    id: 'PV1',
    kind: 'STUDY_APPLY_ISSUE',
    payload,
  }) as unknown as PreviewAction;

describe('StudyApplyIssueApplier', () => {
  it('payload 로 issue 를 만들고 JSL107 을 assignee 로 지정한다', async () => {
    const createIssue = jest.fn().mockResolvedValue({
      number: 12,
      url: 'https://github.com/o/r/issues/12',
    });
    const applier = new StudyApplyIssueApplier({
      createIssue,
    } as unknown as GithubClientPort);

    const result = await applier.apply(
      preview({
        studyBriefId: 3,
        repo: 'JSL107/personal_agents',
        title: 't',
        body: 'b',
      }),
    );

    expect(createIssue).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents',
      title: 't',
      body: 'b',
      assignees: ['JSL107'],
    });
    expect(result.message).toContain('#12');
    expect('resumable' in applier).toBe(false);
  });

  it('payload 형식이 틀리면 GitHub 를 부르지 않고 실패한다', async () => {
    const createIssue = jest.fn();
    const applier = new StudyApplyIssueApplier({
      createIssue,
    } as unknown as GithubClientPort);
    await expect(applier.apply(preview({ repo: 'x' }))).rejects.toThrow();
    expect(createIssue).not.toHaveBeenCalled();
  });
});
