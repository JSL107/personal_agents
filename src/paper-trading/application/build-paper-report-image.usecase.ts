import { Inject, Injectable, Logger } from '@nestjs/common';

import { buildEquityCurveChart } from '../domain/equity-curve';
import {
  REPORT_RENDERER_PORT,
  ReportRendererPort,
} from '../domain/port/report-renderer.port';
import {
  buildPaperReportHtml,
  PAPER_REPORT_WIDTH_PX,
} from '../infrastructure/paper-report.html';
import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';

// 리포트에 담을 기간. 시드 대비 수익률이라 계좌 개설 이후 전체가 의미 있는 구간이지만,
// 길어지면 한 장에 압축돼 최근 움직임이 안 보인다. 4개월이면 분기 흐름과 최근 몇 주가
// 함께 읽히고, 그보다 짧은 계좌는 개설일부터 전체가 그대로 나온다.
const REPORT_WINDOW_DAYS = 120;
const REPORT_ACCOUNT_NAMES = ['LONG_TERM', 'SWING'];

export interface PaperReportImage {
  png: Buffer;
  filename: string;
  title: string;
}

@Injectable()
export class BuildPaperReportImageUsecase {
  private readonly logger = new Logger(BuildPaperReportImageUsecase.name);

  constructor(
    private readonly repository: PaperTradingPrismaRepository,
    @Inject(REPORT_RENDERER_PORT)
    private readonly renderer: ReportRendererPort,
  ) {}

  /**
   * 수익률 곡선 리포트를 PNG 로 만든다. 그릴 것이 없으면 `null` — 계좌가 아직 없거나
   * 평가 스냅샷이 하나도 없는 상태다. 빈 차트를 올리는 것보다 안 올리는 편이 낫다.
   *
   * 렌더는 Chromium 을 띄우므로 실패할 수 있다(메모리 부족, 실행 파일 없음 등).
   * 그 실패로 장마감 보고 전체가 죽으면 그림 하나 때문에 그날 수익률을 못 보게 되므로,
   * 여기서 잡아 `null` 로 물러선다 — 호출부는 그림 없이 요약을 보낸다.
   */
  async execute(asOf: Date): Promise<PaperReportImage | null> {
    try {
      const from = new Date(asOf);
      from.setUTCDate(from.getUTCDate() - REPORT_WINDOW_DAYS);
      const curve = await this.repository.findEquityCurveWithBenchmark({
        accountNames: REPORT_ACCOUNT_NAMES,
        from,
        asOf,
      });
      const chart = buildEquityCurveChart({
        series: curve.series.map((entry) => ({
          accountName: entry.accountName,
          points: entry.points,
        })),
        benchmark: curve.benchmark.map((point) => ({
          tradeDate: point.tradeDate,
          close: Number(point.close.toString()),
        })),
        benchmarkLabel: 'KOSPI',
      });
      if (chart.lines.length === 0) {
        this.logger.log(
          `리포트 생략 — 그릴 곡선이 없다 (${chart.benchmarkOmittedReason ?? '사유 미상'})`,
        );
        return null;
      }
      const asOfText = asOf.toISOString().slice(0, 10);
      const png = await this.renderer.render({
        html: buildPaperReportHtml({ chart, asOf: asOfText }),
        widthPx: PAPER_REPORT_WIDTH_PX,
      });
      return {
        png,
        filename: `paper-return-${asOfText}.png`,
        title: `모의투자 수익률 — ${asOfText}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`리포트 이미지 생성 실패, 그림 없이 진행: ${message}`);
      return null;
    }
  }
}
