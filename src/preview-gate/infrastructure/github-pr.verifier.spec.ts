import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { VerifiableArtifact } from '../domain/apply-result.type';
import { GithubPrVerifier } from './github-pr.verifier';

const buildGithubMock = (
  getPullRequest: jest.Mock,
): jest.Mocked<GithubClientPort> =>
  ({
    getPullRequest,
  }) as unknown as jest.Mocked<GithubClientPort>;

const prArtifact: VerifiableArtifact = {
  type: 'github_pr',
  repo: 'JSL107/personal_agents',
  prNumber: 707,
};

describe('GithubPrVerifier', () => {
  it('supports — github_pr artifact 만 처리', () => {
    const verifier = new GithubPrVerifier(buildGithubMock(jest.fn()));
    expect(verifier.supports(prArtifact)).toBe(true);
  });

  it('verify — getPullRequest 가 PR 을 반환하면 verified=true', async () => {
    const getPullRequest = jest.fn().mockResolvedValue({ number: 707 });
    const verifier = new GithubPrVerifier(buildGithubMock(getPullRequest));

    const outcome = await verifier.verify(prArtifact);

    expect(getPullRequest).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents',
      number: 707,
    });
    expect(outcome.verified).toBe(true);
    expect(outcome.detail).toContain('707');
    expect(outcome.unverifiableReason).toBeUndefined();
  });

  it('verify — getPullRequest 가 throw 하면 verified=false + unverifiableReason (작업 실패 단정 X)', async () => {
    const getPullRequest = jest.fn().mockRejectedValue(new Error('Not Found'));
    const verifier = new GithubPrVerifier(buildGithubMock(getPullRequest));

    const outcome = await verifier.verify(prArtifact);

    expect(outcome.verified).toBe(false);
    expect(outcome.unverifiableReason).toBeDefined();
  });
});
