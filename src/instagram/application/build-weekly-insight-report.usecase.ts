import { Inject, Injectable } from '@nestjs/common';

import { getKstDateOf, utcMidnightOf } from '../../common/util/kst-date.util';
import {
  INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT,
  InstagramInsightSnapshotRepositoryPort,
} from '../domain/port/instagram-insight-snapshot.repository.port';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../domain/port/instagram-post.repository.port';
import { formatWeeklyInsightReport } from './weekly-insight-report';

const DAY_MS = 24 * 60 * 60 * 1000;

// 지난주(월~일, KST) 리포트. 누적 비교를 위해 게시된 행 전부를 읽는다 — 하루 2건이라 몇 년치여도 작다.
@Injectable()
export class BuildWeeklyInsightReportUsecase {
  now = (): Date => new Date();

  constructor(
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly posts: InstagramPostRepositoryPort,
    @Inject(INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT)
    private readonly snapshots: InstagramInsightSnapshotRepositoryPort,
  ) {}

  async execute(): Promise<string | null> {
    const now = this.now();
    const today = utcMidnightOf(getKstDateOf(now));
    // 일요일이면 그 주가 아직 안 끝났으므로 한 주 더 앞을 본다.
    const daysSinceSunday = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
    const weekEnd = new Date(today.getTime() - daysSinceSunday * DAY_MS);
    const weekStart = new Date(weekEnd.getTime() - 6 * DAY_MS);
    const posts = await this.posts.listPublishedSince(new Date(0));
    const snapshots = await this.snapshots.listByPostIds(
      posts.map((post) => post.id),
    );
    return formatWeeklyInsightReport({
      weekStartKst: weekStart.toISOString().slice(0, 10),
      weekEndKst: weekEnd.toISOString().slice(0, 10),
      now,
      posts,
      snapshots,
    });
  }
}
