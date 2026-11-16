import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { TargetRepoRulesLoader } from './target-repo-rules.loader';

const buildLoader = (
  files: Record<string, string>,
): { loader: TargetRepoRulesLoader; getFileFromBranch: jest.Mock } => {
  const getFileFromBranch = jest.fn(async ({ path }: { path: string }) => {
    if (!(path in files)) {
      throw new Error('GitHub 요청 실패: Not Found (404)');
    }
    return {
      fileUrl: `https://github.com/o/r/blob/x/${path}`,
      content: files[path],
    };
  });
  const githubClient = { getFileFromBranch } as unknown as GithubClientPort;
  return { loader: new TargetRepoRulesLoader(githubClient), getFileFromBranch };
};

describe('TargetRepoRulesLoader', () => {
  it('base 커밋의 문서에서 리뷰 절을 싣고, 없는 파일은 조용히 건너뛴다', async () => {
    const { loader, getFileFromBranch } = buildLoader({
      'AGENTS.md': '# AGENTS.md\n## Review Focus\n- 권한 검사 누락을 본다',
    });

    const rules = await loader.load({ repo: 'o/r', baseSha: 'base1' });

    expect(rules.used).toEqual(['AGENTS.md#Review Focus']);
    expect(getFileFromBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'o/r',
        branch: 'base1',
        path: 'AGENTS.md',
      }),
    );
  });

  it('같은 레포·같은 base 커밋은 다시 조회하지 않고, base 가 바뀌면 새로 받는다', async () => {
    const { loader, getFileFromBranch } = buildLoader({
      'AGENTS.md': '## Code Review Rules\n- A',
    });

    await loader.load({ repo: 'o/r', baseSha: 'base1' });
    const callsAfterFirst = getFileFromBranch.mock.calls.length;
    await loader.load({ repo: 'O/R', baseSha: 'base1' });
    expect(getFileFromBranch.mock.calls.length).toBe(callsAfterFirst);

    await loader.load({ repo: 'o/r', baseSha: 'base2' });
    expect(getFileFromBranch.mock.calls.length).toBe(callsAfterFirst * 2);
  });

  it('문서가 하나도 없으면 빈 블록이다', async () => {
    const { loader } = buildLoader({});
    await expect(loader.load({ repo: 'o/r', baseSha: 'b' })).resolves.toEqual({
      block: '',
      used: [],
    });
  });
});
