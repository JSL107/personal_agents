import { Prisma } from '@prisma/client';

import { ReportRendererPort } from '../domain/port/report-renderer.port';
import {
  EquityCurveWithBenchmark,
  PaperTradingPrismaRepository,
} from '../infrastructure/paper-trading.prisma.repository';
import { BuildPaperReportImageUsecase } from './build-paper-report-image.usecase';

const asOf = new Date('2026-09-22T00:00:00.000Z');

const CURVE: EquityCurveWithBenchmark = {
  series: [
    {
      accountName: 'LONG_TERM',
      seedAmount: new Prisma.Decimal('10000000'),
      points: [
        {
          tradeDate: new Date('2026-09-18T00:00:00.000Z'),
          returnRatePercent: 1,
        },
        {
          tradeDate: new Date('2026-09-19T00:00:00.000Z'),
          returnRatePercent: 3,
        },
      ],
    },
  ],
  benchmark: [
    {
      tradeDate: new Date('2026-09-18T00:00:00.000Z'),
      close: new Prisma.Decimal('2000'),
    },
    {
      tradeDate: new Date('2026-09-19T00:00:00.000Z'),
      close: new Prisma.Decimal('2100'),
    },
  ],
};

const createFixture = (input?: {
  curve?: EquityCurveWithBenchmark;
  curveError?: Error;
  renderError?: Error;
}) => {
  const repository = {
    findEquityCurveWithBenchmark: input?.curveError
      ? jest.fn().mockRejectedValue(input.curveError)
      : jest.fn().mockResolvedValue(input?.curve ?? CURVE),
  };
  const renderer = {
    render: input?.renderError
      ? jest.fn().mockRejectedValue(input.renderError)
      : jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
  };
  return {
    usecase: new BuildPaperReportImageUsecase(
      repository as unknown as PaperTradingPrismaRepository,
      renderer as unknown as ReportRendererPort,
    ),
    repository,
    renderer,
  };
};

describe('BuildPaperReportImageUsecase', () => {
  it('곡선을 그려 PNG 와 기준일이 박힌 파일명을 낸다', async () => {
    const { usecase, renderer } = createFixture();

    const image = await usecase.execute(asOf);

    expect(image).toEqual({
      png: Buffer.from('png-bytes'),
      filename: 'paper-return-2026-09-22.png',
      title: '모의투자 수익률 — 2026-09-22',
    });
    // 렌더 폭은 HTML 의 캔버스 폭과 같아야 한다 — 좁으면 SVG 오른쪽 끝 라벨이 잘린다.
    expect(renderer.render).toHaveBeenCalledWith({
      html: expect.stringContaining('<svg'),
      widthPx: 720,
    });
  });

  // 조회 창을 좁게 잡으면 곡선이 최근 며칠로 잘리고, 넓게 잡으면 한 장에 압축된다.
  // 어느 쪽도 조용히 바뀌면 안 되므로 창의 양 끝을 계약으로 고정한다.
  it('기준일에서 120일 거슬러 올라간 구간을 두 전략 계좌로 조회한다', async () => {
    const { usecase, repository } = createFixture();

    await usecase.execute(asOf);

    expect(repository.findEquityCurveWithBenchmark).toHaveBeenCalledWith({
      accountNames: ['LONG_TERM', 'SWING'],
      from: new Date('2026-05-25T00:00:00.000Z'),
      asOf,
    });
  });

  // 빈 차트를 올리면 "그림이 있는데 아무것도 안 보인다" 가 되어, 데이터가 없는 것인지
  // 렌더가 깨진 것인지 읽는 사람이 구분할 수 없다.
  it('그릴 곡선이 없으면 렌더하지 않고 null 을 낸다', async () => {
    const { usecase, renderer } = createFixture({
      curve: { series: [], benchmark: [] },
    });

    await expect(usecase.execute(asOf)).resolves.toBeNull();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  // 그림 하나 때문에 그날 수익률 보고가 통째로 죽으면 안 된다. 호출부(장마감 task)는
  // null 을 받으면 요약만 보낸다.
  it('원장 조회가 실패해도 던지지 않고 null 로 물러선다', async () => {
    const { usecase } = createFixture({
      curveError: new Error('connection terminated'),
    });

    await expect(usecase.execute(asOf)).resolves.toBeNull();
  });

  it('렌더가 실패해도 던지지 않고 null 로 물러선다', async () => {
    const { usecase } = createFixture({
      renderError: new Error('Failed to launch the browser process'),
    });

    await expect(usecase.execute(asOf)).resolves.toBeNull();
  });
});
