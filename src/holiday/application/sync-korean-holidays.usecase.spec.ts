import { ListSchedulesUsecase } from '../../schedule/application/list-schedules.usecase';
import { MarkScheduleAsHolidayUsecase } from '../../schedule/application/mark-schedule-as-holiday.usecase';
import { RegisterScheduleUsecase } from '../../schedule/application/register-schedule.usecase';
import {
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../schedule/domain/schedule.type';
import { KoreanHoliday } from '../domain/holiday.type';
import { KoreanHolidayClientPort } from '../domain/port/korean-holiday.client.port';
import { SyncKoreanHolidaysUsecase } from './sync-korean-holidays.usecase';

const OWNER = 'U_OWNER';

const holiday = (
  name: string,
  month: number,
  day: number,
  year = 2026,
): KoreanHoliday => ({ name, date: { year, month, day } });

const record = (
  title: string,
  isoDate: string,
  isHoliday = true,
  id = 1,
): ScheduleItemRecord => ({
  id,
  slackUserId: OWNER,
  title,
  dueDate: new Date(isoDate),
  dueTime: null,
  linkUrl: null,
  memo: null,
  status: ScheduleStatus.OPEN,
  completedAt: null,
  isHoliday,
});

// 달(1~12)별 응답을 미리 정해 두는 가짜 클라이언트. 12번 호출되는 것 자체가 계약이라
// 호출 인자를 남겨 검증한다.
const stubClient = (
  byMonth: Record<number, KoreanHoliday[]>,
  configured = true,
): KoreanHolidayClientPort & { calls: string[] } => ({
  calls: [] as string[],
  isConfigured: (): boolean => configured,
  fetchMonth(year: number, month: number): Promise<KoreanHoliday[]> {
    this.calls.push(`${year}-${month}`);
    return Promise.resolve(byMonth[month] ?? []);
  },
});

const build = (
  client: KoreanHolidayClientPort,
  existing: ScheduleItemRecord[] = [],
): {
  usecase: SyncKoreanHolidaysUsecase;
  saved: Array<{ title: string; isHoliday?: boolean }>;
  promotedIds: number[];
} => {
  const saved: Array<{ title: string; isHoliday?: boolean }> = [];
  const promotedIds: number[] = [];
  const list = {
    execute: (): Promise<ScheduleItemRecord[]> => Promise.resolve(existing),
  } as unknown as ListSchedulesUsecase;
  const register = {
    execute: (input: {
      title: string;
      isHoliday?: boolean;
    }): Promise<ScheduleItemRecord> => {
      saved.push({ title: input.title, isHoliday: input.isHoliday });
      return Promise.resolve(record(input.title, '2026-01-01T00:00:00.000Z'));
    },
  } as unknown as RegisterScheduleUsecase;
  const markAsHoliday = {
    execute: (id: number): Promise<ScheduleItemRecord> => {
      promotedIds.push(id);
      return Promise.resolve(record('승격됨', '2026-01-01T00:00:00.000Z'));
    },
  } as unknown as MarkScheduleAsHolidayUsecase;
  return {
    usecase: new SyncKoreanHolidaysUsecase(
      client,
      list,
      register,
      markAsHoliday,
    ),
    saved,
    promotedIds,
  };
};

describe('SyncKoreanHolidaysUsecase', () => {
  it('공휴일을 isHoliday=true 로 저장한다 — 이 필드 하나가 달력 색과 브리핑 제외를 지탱한다', async () => {
    const client = stubClient({ 9: [holiday('추석', 9, 25)] });
    const { usecase, saved } = build(client);

    const result = await usecase.execute({ slackUserId: OWNER, years: [2026] });

    expect(saved).toEqual([{ title: '추석', isHoliday: true }]);
    expect(result.created).toBe(1);
    expect(result.skippedReason).toBeNull();
  });

  it('한 해를 12번 나눠 부른다 — 한 달이라도 빠지면 그 달이 조용히 빈다', async () => {
    const client = stubClient({});
    const { usecase } = build(client);

    await usecase.execute({ slackUserId: OWNER, years: [2026] });

    expect(client.calls).toHaveLength(12);
    expect(client.calls[0]).toBe('2026-1');
    expect(client.calls[11]).toBe('2026-12');
  });

  // 매주 도는 작업이라 멱등하지 않으면 같은 공휴일이 주마다 한 줄씩 쌓인다.
  it('이미 공휴일로 들어간 줄이 있으면 아무것도 하지 않는다', async () => {
    const client = stubClient({ 9: [holiday('추석', 9, 25)] });
    const { usecase, saved, promotedIds } = build(client, [
      record('추석', '2026-09-25T00:00:00.000Z'),
    ]);

    const result = await usecase.execute({ slackUserId: OWNER, years: [2026] });

    expect(saved).toEqual([]);
    expect(promotedIds).toEqual([]);
    expect(result.created).toBe(0);
    expect(result.alreadyPresent).toBe(1);
  });

  // 건너뛰기만 하면 그 줄은 `isHoliday=false` 로 남아 달력에서 빨갛게 서지도, 아침
  // 브리핑에서 빠지지도 않는다 — 그 날만 이 기능이 통째로 안 먹는다.
  it('사용자가 손으로 넣어 둔 같은 날·같은 이름의 일정은 공휴일로 승격한다', async () => {
    const client = stubClient({ 9: [holiday('추석', 9, 25)] });
    const { usecase, saved, promotedIds } = build(client, [
      record('추석', '2026-09-25T00:00:00.000Z', false, 77),
    ]);

    const result = await usecase.execute({ slackUserId: OWNER, years: [2026] });

    // 새 줄을 만들지 않는다 — 달력에 같은 이름이 두 줄로 서면 안 된다.
    expect(saved).toEqual([]);
    expect(promotedIds).toEqual([77]);
    expect(result.promoted).toBe(1);
    expect(result.created).toBe(0);
  });

  it('같은 날 같은 제목이 두 줄이면 이미 공휴일인 쪽을 남기고 승격하지 않는다', async () => {
    const client = stubClient({ 9: [holiday('추석', 9, 25)] });
    const { usecase, promotedIds } = build(client, [
      record('추석', '2026-09-25T00:00:00.000Z', false, 10),
      record('추석', '2026-09-25T00:00:00.000Z', true, 11),
    ]);

    const result = await usecase.execute({ slackUserId: OWNER, years: [2026] });

    expect(promotedIds).toEqual([]);
    expect(result.alreadyPresent).toBe(1);
  });

  it('같은 회차에 같은 공휴일이 두 번 와도 한 번만 넣는다', async () => {
    const client = stubClient({
      9: [holiday('추석', 9, 25)],
      10: [holiday('추석', 9, 25)],
    });
    const { usecase, saved } = build(client);

    const result = await usecase.execute({ slackUserId: OWNER, years: [2026] });

    expect(saved).toHaveLength(1);
    expect(result.created).toBe(1);
    expect(result.alreadyPresent).toBe(1);
  });

  // 키가 없는 것은 고장이 아니다. 예외로 끊으면 매주 실패 알람이 뜨고, 조용히 0건을
  // 돌려주면 "올해 공휴일이 없다" 처럼 보인다 — 사유를 실어 가른다.
  it('API 키가 없으면 조회하지 않고 사유를 돌려준다', async () => {
    const client = stubClient({ 9: [holiday('추석', 9, 25)] }, false);
    const { usecase, saved } = build(client);

    const result = await usecase.execute({ slackUserId: OWNER, years: [2026] });

    expect(client.calls).toEqual([]);
    expect(saved).toEqual([]);
    expect(result.skippedReason).toContain('KOREAN_HOLIDAY_API_KEY');
  });

  // 절반만 들어간 해는 "8월엔 광복절이 없다" 처럼 보이는데, 빠진 것과 원래 없는 것이
  // 구분되지 않는다. 멱등 저장이라 다음 회차가 메운다.
  it('한 달이라도 조회에 실패하면 그 해를 중단한다 — 반쪽짜리 해를 만들지 않는다', async () => {
    const failing: KoreanHolidayClientPort = {
      isConfigured: (): boolean => true,
      fetchMonth: (_year: number, month: number): Promise<KoreanHoliday[]> =>
        month === 3
          ? Promise.reject(new Error('HTTP 500'))
          : Promise.resolve([holiday('신정', 1, 1)]),
    };
    const { usecase } = build(failing);

    await expect(
      usecase.execute({ slackUserId: OWNER, years: [2026] }),
    ).rejects.toThrow('HTTP 500');
  });
});
