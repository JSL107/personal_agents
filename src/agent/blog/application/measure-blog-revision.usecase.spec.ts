import { ConfigService } from '@nestjs/config';

import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { FindRecentAppliedPreviewsUsecase } from '../../../preview-gate/application/find-recent-applied-previews.usecase';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { MeasureBlogRevisionUsecase } from './measure-blog-revision.usecase';

const PUBLISHED = '첫 줄이에요.\n둘째 줄이에요.\n셋째 줄이에요.';

interface Overrides {
  previews?: unknown[];
  file?: Partial<Record<string, string | undefined>>;
  fileThrows?: boolean;
  config?: Record<string, string | undefined>;
}

const buildUsecase = ({
  previews = [],
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
  const execute = jest.fn(async () => previews as PreviewAction[]);

  const usecase = new MeasureBlogRevisionUsecase(
    { execute } as unknown as FindRecentAppliedPreviewsUsecase,
    { getFileFromBranch } as unknown as GithubClientPort,
    { get: (key: string) => config[key] } as unknown as ConfigService,
  );
  return { usecase, getFileFromBranch, findPreviews: execute };
};

const applied = (path: string, content: string) => ({
  id: 'preview-1',
  payload: { path, content },
  appliedAt: new Date('2026-09-01T00:00:00Z'),
});

describe('MeasureBlogRevisionUsecase', () => {
  it('발행 설정이 없으면 집계 대상이 아니라고 답한다', () => {
    const { usecase } = buildUsecase({ config: {} });

    expect(usecase.isConfigured()).toBe(false);
  });

  it('승인된 발행 카드만 조회한다', async () => {
    // 실행 원장(BLOG_PUBLISH AgentRun)은 승인 카드를 만든 시점에 이미 SUCCEEDED 라, 그것으로
    // 세면 거절·만료된 카드의 본문까지 발행본으로 집계된다.
    const { usecase, findPreviews } = buildUsecase();

    await usecase.execute();

    expect(findPreviews).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'BLOG_GITHUB_PUBLISH' }),
    );
  });

  it('발행본과 최종본을 짝지어 수정률을 낸다', async () => {
    const { usecase } = buildUsecase({
      previews: [applied('posts/a.md', PUBLISHED)],
      file: { 'posts/a.md': '첫 줄이에요.\n고쳐진 줄이에요.\n셋째 줄이에요.' },
    });

    const report = await usecase.execute();

    expect(report.rows).toHaveLength(1);
    // 세 줄 중 한 줄이 바뀌었다 — 추가 1 + 삭제 1 을 원본 3 으로 나눈다.
    expect(report.rows[0].count.percent).toBe(67);
    // 발행 시각은 카드가 승인된 때다. 카드를 만든 때가 아니라야 구간 비교가 맞는다.
    expect(report.rows[0].publishedAt).toEqual(
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(report.unmatchedCount).toBe(0);
  });

  it('최종본을 못 찾으면 그 글만 빼고 편수를 남긴다', async () => {
    // 한 편이 없다고 회차 전체를 버리면 나머지 글의 수정률까지 사라진다. 반대로 조용히
    // 빼기만 하면 평균이 실제보다 좋아 보이므로 빠진 편수를 함께 돌려준다.
    const { usecase } = buildUsecase({
      previews: [applied('posts/gone.md', PUBLISHED)],
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
      previews: [applied('posts/big.md', PUBLISHED)],
      file: { 'posts/big.md': undefined },
    });

    const report = await usecase.execute();

    expect(report.rows).toHaveLength(0);
    expect(report.unmatchedCount).toBe(1);
  });

  it('path·content 가 없는 옛 카드는 조회하지 않는다', async () => {
    const { usecase, getFileFromBranch } = buildUsecase({
      previews: [{ id: 'old', payload: { title: '옛 형태' }, appliedAt: null }],
    });

    const report = await usecase.execute();

    expect(report.rows).toHaveLength(0);
    expect(getFileFromBranch).not.toHaveBeenCalled();
  });
});
