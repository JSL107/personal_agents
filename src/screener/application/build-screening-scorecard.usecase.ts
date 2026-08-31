import { Injectable } from '@nestjs/common';

import { SCREENING_OUTCOME_HORIZONS } from '../domain/screening-outcome';
import {
  buildScorecardHorizon,
  ScreeningScorecardHorizon,
} from '../domain/screening-scorecard';
import { ScreeningHistoryPrismaRepository } from '../infrastructure/screening-history.prisma.repository';

// "최근 7일 새로 판정된 건수" 를 세는 창. 주 경계를 계산하지 않고 고정 7일을 쓴다 —
// 카드가 주 1회 발화하므로 결과가 같고, 경계 계산이 없으면 어긋날 자리도 없다.
const NEWLY_SCORED_WINDOW_DAYS = 7;

export interface BuildScreeningScorecardOptions {
  asOf: Date;
}

export interface BuildScreeningScorecardResult {
  asOf: Date;
  horizons: ScreeningScorecardHorizon[];
}

// 회차에 실린 종목의 사후 성적을 "산 것 / 안 산 것" 으로 갈라 세운다. 표는 누적이고,
// 표본이 늘고 있는지는 지평별 신규 건수로 따로 적는다 — 누적만 적으면 채점이 멈춘 것과
// 표본이 원래 그만큼인 것을 구분할 수 없다.
//
// 지평은 표본이 없어도 목록에서 빼지 않는다. 빼면 20거래일 축이 카드에서 조용히
// 사라져, 아직 안 온 것과 채점이 고장난 것을 읽는 사람이 가릴 수 없다.
@Injectable()
export class BuildScreeningScorecardUsecase {
  constructor(private readonly repository: ScreeningHistoryPrismaRepository) {}

  async execute(
    options: BuildScreeningScorecardOptions,
  ): Promise<BuildScreeningScorecardResult> {
    const since = new Date(options.asOf);
    since.setUTCDate(since.getUTCDate() - NEWLY_SCORED_WINDOW_DAYS);

    const horizons: ScreeningScorecardHorizon[] = [];
    for (const horizonDays of SCREENING_OUTCOME_HORIZONS) {
      horizons.push(
        buildScorecardHorizon({
          horizonDays,
          rows: await this.repository.findScorecardRows(horizonDays),
          newlyScoredCount: await this.repository.countScoredSince(
            horizonDays,
            since,
          ),
          pendingRunCount:
            await this.repository.countRunsPendingOutcome(horizonDays),
        }),
      );
    }
    return { asOf: options.asOf, horizons };
  }
}
