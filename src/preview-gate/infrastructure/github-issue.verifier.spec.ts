import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { VerifiableArtifact } from '../domain/apply-result.type';
import { GithubIssueVerifier } from './github-issue.verifier';

const buildGithubMock = (
  getItemLifecycle: jest.Mock,
): jest.Mocked<GithubClientPort> =>
  ({
    getItemLifecycle,
  }) as unknown as jest.Mocked<GithubClientPort>;

const issueArtifact: VerifiableArtifact = {
  type: 'github_issue',
  repo: 'JSL107/personal_agents',
  issueNumber: 12,
};

describe('GithubIssueVerifier', () => {
  it('supports — github_issue artifact 만 처리', () => {
    const verifier = new GithubIssueVerifier(buildGithubMock(jest.fn()));
    expect(verifier.supports(issueArtifact)).toBe(true);
    expect(
      verifier.supports({ type: 'github_pr', repo: 'o/r', prNumber: 1 }),
    ).toBe(false);
  });

  it('verify — issues.get 이 issue 를 반환하면 verified=true', async () => {
    const getItemLifecycle = jest.fn().mockResolvedValue({
      state: 'open',
      mergedAt: null,
      isPullRequest: false,
    });
    const verifier = new GithubIssueVerifier(buildGithubMock(getItemLifecycle));

    const outcome = await verifier.verify(issueArtifact);

    expect(getItemLifecycle).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents',
      number: 12,
    });
    expect(outcome.verified).toBe(true);
    expect(outcome.detail).toContain('#12');
    expect(outcome.unverifiableReason).toBeUndefined();
  });

  it('verify — 재조회가 throw 하면 verified=false + unverifiableReason (작업 실패 단정 X)', async () => {
    const getItemLifecycle = jest
      .fn()
      .mockRejectedValue(new Error('Not Found'));
    const verifier = new GithubIssueVerifier(buildGithubMock(getItemLifecycle));

    const outcome = await verifier.verify(issueArtifact);

    expect(outcome.verified).toBe(false);
    expect(outcome.unverifiableReason).toBeDefined();
    expect(outcome.detail).not.toContain('Not Found');
  });
});
