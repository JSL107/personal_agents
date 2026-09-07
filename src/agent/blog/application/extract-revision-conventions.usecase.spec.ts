import { Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { ExtractRevisionConventionsUsecase } from './extract-revision-conventions.usecase';
import { BlogRevisionReport } from './measure-blog-revision.usecase';

const now = new Date('2026-09-07T00:00:00Z');
const buildReport = (count: number): BlogRevisionReport => ({
  rows: Array.from({ length: count }, (_, index) => ({
    path: 'post-' + index + '.md',
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    count: {
      addedLines: 1,
      removedLines: 1,
      totalLines: 2,
      percent: 100 - index,
    },
    changes: { removedLines: ['삭제 ' + index], addedLines: ['추가 ' + index] },
  })),
  summary: { postCount: count, averagePercent: 50, untouchedCount: 0 },
  unmatchedCount: 0,
});

describe('ExtractRevisionConventionsUsecase', () => {
  it('표본 하한 미달이면 모델을 호출하지 않는다', async () => {
    const route = jest.fn();
    const usecase = new ExtractRevisionConventionsUsecase({
      route,
    } as unknown as ModelRouterUsecase);

    await expect(usecase.execute(buildReport(2), now)).resolves.toEqual({
      conventions: [],
      modelUsed: 'none',
    });
    expect(route).not.toHaveBeenCalled();
  });

  it('최근 수정률 상위 3편을 모델에 보내고 규칙을 상한까지 검증한다', async () => {
    const route = jest.fn().mockResolvedValue({
      modelUsed: 'codex',
      text: JSON.stringify({
        conventions: [
          ' 규칙 1 ',
          '규칙 2\n불가',
          'x'.repeat(201),
          42,
          '규칙 3',
          '규칙 4',
          '규칙 5',
          '규칙 6',
        ],
      }),
    });
    const usecase = new ExtractRevisionConventionsUsecase({
      route,
    } as unknown as ModelRouterUsecase);

    const result = await usecase.execute(buildReport(5), now);

    expect(result).toEqual({
      conventions: ['규칙 1', '규칙 3', '규칙 4', '규칙 5'],
      modelUsed: 'codex',
    });
    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'BLOG_REVISION' }),
    );
    expect(route.mock.calls[0][0].request.prompt).toContain('삭제 0');
    expect(route.mock.calls[0][0].request.prompt).toContain('삭제 2');
    expect(route.mock.calls[0][0].request.prompt).not.toContain('삭제 3');
  });

  it('최근 14일 안에서 수정률 상위 3편을 골라 정렬한다', async () => {
    const route = jest.fn().mockResolvedValue({
      modelUsed: 'codex',
      text: JSON.stringify({ conventions: [] }),
    });
    const report = buildReport(5);
    report.rows[0].publishedAt = new Date('2026-08-20T00:00:00Z');
    report.rows[1].publishedAt = new Date('2026-09-08T00:00:00Z');
    report.rows[2].count.percent = 1;
    report.rows = [
      report.rows[2],
      report.rows[4],
      report.rows[1],
      report.rows[3],
      report.rows[0],
    ];
    const usecase = new ExtractRevisionConventionsUsecase({
      route,
    } as unknown as ModelRouterUsecase);

    await usecase.execute(report, now);

    const prompt = route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('삭제 4');
    expect(prompt).toContain('삭제 3');
    expect(prompt).toContain('삭제 2');
    expect(prompt).not.toContain('삭제 0');
    expect(prompt).not.toContain('삭제 1');
  });

  it('정확히 200자인 한 줄 규칙은 허용한다', async () => {
    const route = jest.fn().mockResolvedValue({
      modelUsed: 'codex',
      text: JSON.stringify({ conventions: ['x'.repeat(200)] }),
    });
    const usecase = new ExtractRevisionConventionsUsecase({
      route,
    } as unknown as ModelRouterUsecase);

    await expect(usecase.execute(buildReport(3), now)).resolves.toEqual({
      conventions: ['x'.repeat(200)],
      modelUsed: 'codex',
    });
  });

  it('응답 JSON 형태가 잘못되면 실패를 기록하고 빈 규칙으로 폴백한다', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const usecase = new ExtractRevisionConventionsUsecase({
      route: jest.fn().mockResolvedValue({ modelUsed: 'codex', text: 'null' }),
    } as unknown as ModelRouterUsecase);

    await expect(usecase.execute(buildReport(3), now)).resolves.toEqual({
      conventions: [],
      modelUsed: 'none',
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('블로그 수정 규칙 추출 실패'),
    );
    warning.mockRestore();
  });

  it('모델 호출 실패는 보고를 막지 않고 빈 규칙으로 폴백한다', async () => {
    const usecase = new ExtractRevisionConventionsUsecase({
      route: jest.fn().mockRejectedValue(new Error('quota')),
    } as unknown as ModelRouterUsecase);

    await expect(usecase.execute(buildReport(3), now)).resolves.toEqual({
      conventions: [],
      modelUsed: 'none',
    });
  });

  // 이 경로는 실패해도 카드가 정상 발송되므로(규칙만 빈 배열) 파싱이 깨져도 신호가 없다.
  // 같은 파이프라인이 펜스 때문에 죽은 이력이 있어(run#864) 추출기를 거치는지 못박아 둔다.
  it('코드펜스와 앞뒤 설명이 섞인 응답에서도 규칙을 읽는다', async () => {
    const route = jest.fn().mockResolvedValue({
      modelUsed: 'codex',
      text: [
        '요청하신 규칙입니다:',
        '```json',
        JSON.stringify({ conventions: ['규칙 1'] }),
        '```',
        '이상입니다.',
      ].join('\n'),
    });
    const usecase = new ExtractRevisionConventionsUsecase({
      route,
    } as unknown as ModelRouterUsecase);

    await expect(usecase.execute(buildReport(3), now)).resolves.toEqual({
      conventions: ['규칙 1'],
      modelUsed: 'codex',
    });
  });

  it('모델이 형태를 지키도록 응답 스키마를 건다', async () => {
    const route = jest.fn().mockResolvedValue({
      modelUsed: 'codex',
      text: JSON.stringify({ conventions: [] }),
    });
    const usecase = new ExtractRevisionConventionsUsecase({
      route,
    } as unknown as ModelRouterUsecase);

    await usecase.execute(buildReport(3), now);

    expect(route.mock.calls[0][0].request.outputSchema).toEqual(
      expect.objectContaining({ required: ['conventions'] }),
    );
  });
});
