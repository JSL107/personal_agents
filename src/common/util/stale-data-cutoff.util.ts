import { ConfigService } from '@nestjs/config';

// OPS-6: GitHub assigned / Notion task 의 stale data 컷오프 정책.
// archive 안 된 long-tail 데이터가 prompt 에 누적되는 것을 막기 위해 N일 이내 update 만 통과시킨다.
// 사용자가 env 로 override 안 하면 60일 기본 (분기 단위 long-tail 보존 + 전 분기 stale 컷의 균형).
export const DEFAULT_STALE_DATA_CUTOFF_DAYS = 60;

export interface StaleDataCutoff {
  days: number;
  // GitHub Search API 의 `updated:>=YYYY-MM-DD` qualifier 용 — UTC 날짜.
  isoDate: string;
  // Notion API 의 `last_edited_time` on_or_after 필터용 — UTC ISO 8601 datetime.
  isoDateTime: string;
}

// 환경변수 STALE_DATA_CUTOFF_DAYS 를 읽어 컷오프 시점을 계산한다.
// 비어있거나 0 이하 / NaN 이면 default(60) fallback.
// `now` 는 테스트에서 deterministic 시각을 주입하기 위한 옵션 — 운영 코드는 인자 생략.
export const resolveStaleDataCutoff = ({
  configService,
  now = new Date(),
}: {
  configService: ConfigService;
  now?: Date;
}): StaleDataCutoff => {
  const raw = configService.get<string>('STALE_DATA_CUTOFF_DAYS')?.trim();
  const parsed = raw && raw.length > 0 ? Number.parseInt(raw, 10) : Number.NaN;
  const days =
    Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_STALE_DATA_CUTOFF_DAYS;

  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs);
  const iso = cutoff.toISOString();

  return {
    days,
    isoDate: iso.slice(0, 10),
    isoDateTime: iso,
  };
};
