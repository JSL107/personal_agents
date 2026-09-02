import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { MeasureBlogRevisionUsecase } from './measure-blog-revision.usecase';

const PUBLISHED = '첫 줄이에요.\n둘째 줄이에요.\n셋째 줄이에요.';

interface Overrides {
  runs?: unknown[];
  file?: Partial<Record<string, string | undefined>>;
  fileThrows?: boolean;
  config?: Record<string, string | undefined>;
}

const buildUsecase = ({
  runs = [],
  file = {},
  fileThrows = false,
  config = { BLOG_PUBLISH_REPO: 'owner/blog', BLOG_PUBLISH_BRANCH: 'main' },
}: Overrides = {}) => {
  const getFileFromBranch = jest.fn(async ({ path }: { path: string }) => {
    if (fileThrows) {
      throw new Error('404');
    }
    return { fileUrl: `https://example.test/${path}`, content: file[path] };
  });

  const usecase = new MeasureBlogRevisionUsecase(
    {
      findRecentSucceededRuns: jest.fn(async () => runs),
    } as unknown as AgentRunService,
    { getFileFromBranch } as unknown as GithubClientPort,
    { get: (key: string) => config[key] } as unknown as ConfigService,
  );
  return { usecase, getFileFromBranch };
};

const run = (path: string, content: string) => ({
  id: 1,
  output: { path, content },
  endedAt: new Date('2026-09-01T00:00:00Z'),
  inputSnapshot: {},
});

describe('MeasureBlogRevisionUsecase', () => {
  it('발행 설정이 없으면 집계 대상이 아니라고 답한다', () => {
    const { usecase } = buildUsecase({ config: {} });

    expect(usecase.isConfigured()).toBe(false);
  });

  it('발행본과 최종본을 짝지어 수정률을 낸다', async () => {
    const { usecase } = buildUsecase({
      runs: [run('posts/a.md', PUBLISHED)],
      file: { 'posts/a.md': '첫 줄이에요.\n고쳐진 줄이에요.\n셋째 줄이에요.' },
    });

    const report = await usecase.execute();

    expect(report.rows).toHaveLength(1);
    // 세 줄 중 한 줄이 바뀌었다 — 추가 1 + 삭제 1 을 원본 3 으로 나눈다.
    expect(report.rows[0].count.percent).toBe(67);
    expect(report.unmatchedCount).toBe(0);
  });

  it('최종본을 못 찾으면 그 글만 빼고 편수를 남긴다', async () => {
    // 한 편이 없다고 회차 전체를 버리면 나머지 글의 수정률까지 사라진다. 반대로 조용히
    // 빼기만 하면 평균이 실제보다 좋아 보이므로 빠진 편수를 함께 돌려준다.
    const { usecase } = buildUsecase({
      runs: [run('posts/gone.md', PUBLISHED)],
      fileThrows: true,
    });

    const report = await usecase.execute();

    expect(report.rows).toHaveLength(0);
    expect(report.unmatchedCount).toBe(1);
  });

  it('본문이 비어 온 응답도 짝을 못 찾은 것으로 센다', async () => {
    // GitHub 은 1MB 를 넘는 파일에 content 를 싣지 않는다. undefined 를 빈 글로 읽으면
    // 「전부 지워졌다」로 집계돼 수정률이 100%로 튄다.
    const { usecase } = buildUsecase({
      runs: [run('posts/big.md', PUBLISHED)],
      file: { 'posts/big.md': undefined },
    });

    const report = await usecase.execute();

    expect(report.rows).toHaveLength(0);
    expect(report.unmatchedCount).toBe(1);
  });

  it('path·content 가 없는 옛 회차는 조회하지 않는다', async () => {
    // 원장에는 이 필드가 없던 시절의 회차가 섞여 있다. 짝을 맞출 수 없는데 GitHub 을
    // 두드리면 회차마다 헛 요청이 나간다.
    const { usecase, getFileFromBranch } = buildUsecase({
      runs: [{ id: 1, output: { message: '옛 형태' }, endedAt: new Date() }],
    });

    const report = await usecase.execute();

    expect(report.rows).toHaveLength(0);
    expect(getFileFromBranch).not.toHaveBeenCalled();
  });
});
