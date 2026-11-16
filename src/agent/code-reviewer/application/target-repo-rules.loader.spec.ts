import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GithubException } from '../../../github/domain/github.exception';
import { GithubErrorCode } from '../../../github/domain/github-error-code.enum';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { TargetRepoRulesLoader } from './target-repo-rules.loader';

let personalDir: string;

beforeEach(async () => {
  personalDir = await mkdtemp(join(tmpdir(), 'review-rules-'));
});

afterEach(async () => {
  await rm(personalDir, { recursive: true, force: true });
});

const buildLoader = (
  files: Record<string, string>,
): { loader: TargetRepoRulesLoader; getFileFromBranch: jest.Mock } => {
  const getFileFromBranch = jest.fn(async ({ path }: { path: string }) => {
    if (!(path in files)) {
      throw new GithubException({
        code: GithubErrorCode.REQUEST_FAILED,
        message: 'GitHub 요청 실패: Not Found',
        cause: Object.assign(new Error('Not Found'), { status: 404 }),
      });
    }
    return {
      fileUrl: `https://github.com/o/r/blob/x/${path}`,
      content: files[path],
    };
  });
  const githubClient = { getFileFromBranch } as unknown as GithubClientPort;
  const loader = new TargetRepoRulesLoader(githubClient);
  // 실제 홈의 개인 규칙을 읽지 않게 테스트 폴더로 돌린다.
  Object.assign(loader, { personalRulesDir: personalDir });
  return { loader, getFileFromBranch };
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

  it('404 가 아닌 조회 실패가 있으면 담아 두지 않고 다음 리뷰가 다시 받는다', async () => {
    const { loader, getFileFromBranch } = buildLoader({
      'AGENTS.md': '## Code Review Rules\n- A',
    });
    getFileFromBranch.mockRejectedValueOnce(
      Object.assign(new Error('Service Unavailable'), { status: 503 }),
    );

    const first = await loader.load({ repo: 'o/r', baseSha: 'b' });
    expect(first.used).toEqual([]);

    const second = await loader.load({ repo: 'o/r', baseSha: 'b' });
    expect(second.used).toEqual(['AGENTS.md#Code Review Rules']);
  });

  it('개인 규칙 파일(<owner>/<repo>.md, 소문자)을 매번 읽어 싣는다', async () => {
    const { loader } = buildLoader({});
    await mkdir(join(personalDir, 'o'), { recursive: true });
    await writeFile(join(personalDir, 'o', 'r.md'), '- 권한 검사를 꼭 본다');

    const first = await loader.load({ repo: 'O/R', baseSha: 'b' });
    expect(first.used).toEqual(['(개인 규칙)']);
    expect(first.block).toContain('- 권한 검사를 꼭 본다');

    await writeFile(join(personalDir, 'o', 'r.md'), '- 바뀐 규칙');
    const second = await loader.load({ repo: 'o/r', baseSha: 'b' });
    expect(second.block).toContain('- 바뀐 규칙');
  });

  it('owner/repo 형식이 아니면 개인 규칙 폴더 밖을 읽지 않는다', async () => {
    const { loader } = buildLoader({});
    await writeFile(join(personalDir, 'secret.md'), '- 비밀');

    const rules = await loader.load({ repo: '../secret', baseSha: 'b' });
    expect(rules.used).toEqual([]);
  });
});
