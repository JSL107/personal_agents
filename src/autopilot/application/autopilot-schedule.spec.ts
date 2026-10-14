import {
  getLedgerWatchTodayStart,
  isLedgerGap,
  LEDGER_GAP_WATCHES,
} from '../domain/ledger-gap-watch';
import { PlaybookEntry } from '../domain/playbook.type';
import {
  findLastFireBefore,
  resolveCronSchedule,
  resolveTaskCronSchedule,
} from './autopilot-schedule';

// 브리핑과 같은 조립 — 실제 플레이북 cron(env 오버라이드 반영)의 직전 회차로 판정한다.
const isGap = (
  taskId: string,
  firedAtKst: string,
  latestBeforeToday: Date | null,
  env: Record<string, string> = {},
): boolean =>
  isLedgerGap(
    latestBeforeToday,
    findLastFireBefore(
      resolveTaskCronSchedule(taskId, (key) => env[key]),
      getLedgerWatchTodayStart(firedAtKst),
    ),
  );

describe('isLedgerGap', () => {
  it('기준점(기록)이 없거나 직전 회차를 못 구하면 조용하다', () => {
    expect(isLedgerGap(null, new Date('2026-10-12T00:00:00Z'))).toBe(false);
    expect(isLedgerGap(new Date('2026-01-01T00:00:00Z'), null)).toBe(false);
  });

  it('감시 대상은 모두 플레이북의 CRON 항목이다', () => {
    for (const { taskId } of LEDGER_GAP_WATCHES) {
      expect(() =>
        resolveTaskCronSchedule(taskId, () => undefined),
      ).not.toThrow();
    }
  });

  describe('cuj-check (매일 09:10)', () => {
    it('이전 실행이 있으나 어제 원장이 없으면 알린다', () => {
      expect(
        isGap('cuj-check', '2026-10-17', new Date('2026-10-15T00:10:00Z')),
      ).toBe(true);
    });

    it('어제 원장이 있으면 조용하다', () => {
      expect(
        isGap('cuj-check', '2026-10-16', new Date('2026-10-15T00:10:00Z')),
      ).toBe(false);
    });

    it('첫 실행 전에는 조용하다', () => {
      expect(isGap('cuj-check', '2026-10-15', null)).toBe(false);
    });

    it('KST 자정 직전 UTC 전날 기록은 전전날로 본다', () => {
      expect(
        isGap('cuj-check', '2026-10-17', new Date('2026-10-15T14:59:59Z')),
      ).toBe(true);
      expect(
        isGap('cuj-check', '2026-10-17', new Date('2026-10-15T15:00:00Z')),
      ).toBe(false);
    });
  });

  describe('run-retro (매주 월 09:00)', () => {
    // 2026-10-12(월) 09:00 KST 회차
    const lastMonday = new Date('2026-10-12T00:00:00Z');

    it('다음 월요일 아침(회차 전)은 조용하다 — 직전 회차는 아직 지난 월요일이다', () => {
      expect(isGap('run-retro', '2026-10-19', lastMonday)).toBe(false);
    });

    it('월요일 회차가 빠지면 화요일 아침에 알린다', () => {
      expect(isGap('run-retro', '2026-10-20', lastMonday)).toBe(true);
    });

    it('월요일 회차가 밤늦게 밀려 돌아도 그날 기록이면 조용하다', () => {
      // 2026-10-19(월) 23:59 KST
      expect(
        isGap('run-retro', '2026-10-20', new Date('2026-10-19T14:59:00Z')),
      ).toBe(false);
    });

    it('주중에는 지난 월요일 기록으로 조용하다', () => {
      expect(isGap('run-retro', '2026-10-18', lastMonday)).toBe(false);
    });
  });

  describe('env 오버라이드를 따른다', () => {
    // run-retro 를 매월 1·15일 09:00 으로 바꾼 경우. 10-01 회차 뒤 다음은 10-15.
    const twiceMonthly = { AUTOPILOT_RUN_RETRO_SCHEDULE: '0 9 1,15 * *' };
    const october1st = new Date('2026-10-01T00:00:00Z');

    it('더 드문 오버라이드 — 기본 주기(7일)가 지나도 다음 회차 전이면 조용하다', () => {
      expect(isGap('run-retro', '2026-10-10', october1st)).toBe(true);
      expect(isGap('run-retro', '2026-10-10', october1st, twiceMonthly)).toBe(
        false,
      );
    });

    it('더 드문 오버라이드 — 그 회차가 빠지면 다음 날 알린다', () => {
      expect(isGap('run-retro', '2026-10-16', october1st, twiceMonthly)).toBe(
        true,
      );
    });

    it('더 촘촘한 오버라이드 — 매일로 바꾸면 하루 빠진 다음 날 알린다', () => {
      const daily = { AUTOPILOT_RUN_RETRO_SCHEDULE: '0 9 * * *' };
      // 10-14(수) 기록, 10-15(목) 결번 → 10-16(금) 아침
      const wednesday = new Date('2026-10-14T00:00:00Z');
      expect(isGap('run-retro', '2026-10-16', wednesday)).toBe(false);
      expect(isGap('run-retro', '2026-10-16', wednesday, daily)).toBe(true);
    });
  });
});

describe('resolveTaskCronSchedule', () => {
  const cron = (
    id: string,
    schedule: string,
    digestGroup?: string,
  ): PlaybookEntry =>
    ({
      id,
      taskId: id,
      trigger: { kind: 'CRON', schedule, timezone: 'Asia/Seoul' },
      riskTier: 'T0_AUTO',
      ...(digestGroup ? { digestGroup } : {}),
    }) as PlaybookEntry;
  const playbook = [
    cron('first', '0 8 * * *', 'morning'),
    cron('second', '0 8 * * *', 'morning'),
    cron('alone', '0 9 * * 1'),
  ];

  it('오버라이드가 없으면 플레이북 기본값', () => {
    expect(resolveTaskCronSchedule('alone', () => undefined, playbook)).toEqual(
      { pattern: '0 9 * * 1', tz: 'Asia/Seoul' },
    );
  });

  it('AUTOPILOT_<ID>_SCHEDULE/TIMEZONE 오버라이드를 쓰고, 공백뿐이면 기본값', () => {
    const env: Record<string, string> = {
      AUTOPILOT_ALONE_SCHEDULE: ' 0 10 * * 2 ',
      AUTOPILOT_ALONE_TIMEZONE: '   ',
    };
    expect(
      resolveTaskCronSchedule('alone', (key) => env[key], playbook),
    ).toEqual({ pattern: '0 10 * * 2', tz: 'Asia/Seoul' });
  });

  it('그룹 소속이면 그룹 첫 항목의 키를 읽는다 — 자기 키는 무시', () => {
    const env: Record<string, string> = {
      AUTOPILOT_FIRST_SCHEDULE: '0 7 * * *',
      AUTOPILOT_SECOND_SCHEDULE: '0 6 * * *',
    };
    expect(
      resolveTaskCronSchedule('second', (key) => env[key], playbook).pattern,
    ).toBe('0 7 * * *');
  });

  it('ai-cli-env 작업은 전용 키를 읽는다', () => {
    const env: Record<string, string> = {
      AI_CLI_ENV_SNAPSHOT_CRON: '5 4 * * *',
    };
    expect(
      resolveCronSchedule(
        cron('ai-cli-env-snapshot', '0 3 * * *'),
        (key) => env[key],
      ).pattern,
    ).toBe('5 4 * * *');
  });

  it('CRON 항목이 없으면 던진다', () => {
    expect(() =>
      resolveTaskCronSchedule('missing', () => undefined, playbook),
    ).toThrow('CRON 항목 없음');
  });
});

describe('findLastFireBefore', () => {
  const before = new Date('2026-10-20T00:00:00+09:00');

  it('주간 cron — 직전 월요일 회차', () => {
    expect(
      findLastFireBefore({ pattern: '0 9 * * 1', tz: 'Asia/Seoul' }, before),
    ).toEqual(new Date('2026-10-19T09:00:00+09:00'));
  });

  it('고빈도 cron — 하루 창 안에서 끝난다', () => {
    expect(
      findLastFireBefore({ pattern: '*/3 * * * *', tz: 'Asia/Seoul' }, before),
    ).toEqual(new Date('2026-10-19T23:57:00+09:00'));
  });

  it('35일 창 안에 회차가 없으면 null', () => {
    expect(
      findLastFireBefore({ pattern: '0 9 1 1 *', tz: 'Asia/Seoul' }, before),
    ).toBeNull();
  });

  it('잘못된 cron 은 던진다', () => {
    expect(() =>
      findLastFireBefore({ pattern: 'bad cron', tz: 'Asia/Seoul' }, before),
    ).toThrow();
  });
});
