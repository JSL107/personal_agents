import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { VerifiableArtifact } from '../domain/apply-result.type';
import { GithubFileVerifier } from './github-file.verifier';

const artifact: VerifiableArtifact = {
  type: 'github_file',
  repo: 'JSL107/JSL107.github.io',
  branch: 'main',
  path: 'src/content/posts/2026-08-15-test-post.md',
  commitSha: 'commit-sha',
};

describe('GithubFileVerifier', () => {
  it('branch의 커밋 파일을 재조회하면 verified=true로 확인한다', async () => {
    const getFileFromBranch = jest.fn().mockResolvedValue({
      fileUrl: 'https://github.com/JSL107/JSL107.github.io/blob/main/file.md',
    });
    const verifier = new GithubFileVerifier({
      getFileFromBranch,
    } as unknown as GithubClientPort);

    const outcome = await verifier.verify(artifact);

    expect(getFileFromBranch).toHaveBeenCalledWith({
      repo: 'JSL107/JSL107.github.io',
      branch: 'main',
      path: 'src/content/posts/2026-08-15-test-post.md',
    });
    expect(outcome).toEqual({
      verified: true,
      detail:
        '파일 JSL107/JSL107.github.io@main:src/content/posts/2026-08-15-test-post.md 반영 확인',
    });
  });

  it('파일 재조회 오류는 발행 실패로 단정하지 않고 수동 확인 안내를 반환한다', async () => {
    const verifier = new GithubFileVerifier({
      getFileFromBranch: jest.fn().mockRejectedValue(new Error('Not Found')),
    } as unknown as GithubClientPort);

    const outcome = await verifier.verify(artifact);

    expect(outcome.verified).toBe(false);
    expect(outcome.unverifiableReason).toBe(
      '재조회 중 일시적 오류 (수동 확인 권장)',
    );
  });
});
