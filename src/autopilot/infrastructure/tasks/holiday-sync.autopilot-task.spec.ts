import {
  SyncKoreanHolidaysResult,
  SyncKoreanHolidaysUsecase,
} from '../../../holiday/application/sync-korean-holidays.usecase';
import { AutopilotTaskContext } from '../../domain/autopilot-task.port';
import { HolidaySyncAutopilotTask } from './holiday-sync.autopilot-task';

const CONTEXT: AutopilotTaskContext = {
  ownerSlackUserId: 'U_OWNER',
  firedAtKst: '2026-09-23',
};

const build = (
  result: SyncKoreanHolidaysResult,
): {
  task: HolidaySyncAutopilotTask;
  inputs: Array<{ slackUserId: string; years: number[] }>;
} => {
  const inputs: Array<{ slackUserId: string; years: number[] }> = [];
  const usecase = {
    execute: (input: {
      slackUserId: string;
      years: number[];
    }): Promise<SyncKoreanHolidaysResult> => {
      inputs.push(input);
      return Promise.resolve(result);
    },
  } as unknown as SyncKoreanHolidaysUsecase;
  return { task: new HolidaySyncAutopilotTask(usecase), inputs };
};

describe('HolidaySyncAutopilotTask', () => {
  // 올해만 넣으면 12월에 다음 해 달력이 통째로 비고, 그 사실은 12월이 되어서야 드러난다.
  it('올해와 내년을 함께 동기화한다', async () => {
    const { task, inputs } = build({
      created: 0,
      alreadyPresent: 0,
      promoted: 0,
      years: [2026, 2027],
      skippedReason: null,
    });

    await task.run(CONTEXT);

    expect(inputs).toEqual([{ slackUserId: 'U_OWNER', years: [2026, 2027] }]);
  });

  // 서버 timezone 이 UTC 면 `new Date().getFullYear()` 가 연말 하루 동안 지난 해를 가리킨다.
  it('연도는 firedAtKst 에서 뽑는다 — 서버 시간대에 흔들리지 않게', async () => {
    const { task, inputs } = build({
      created: 0,
      alreadyPresent: 0,
      promoted: 0,
      years: [],
      skippedReason: null,
    });

    await task.run({ ...CONTEXT, firedAtKst: '2026-12-31' });

    expect(inputs[0].years).toEqual([2026, 2027]);
  });

  it('새로 넣은 것이 있으면 건수를 알린다', async () => {
    const { task } = build({
      created: 3,
      alreadyPresent: 30,
      promoted: 0,
      years: [2026, 2027],
      skippedReason: null,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('3건');
  });

  // 두 번째 회차부터는 신규 0건이 정상이다. 「0건」 을 매주 보내면 정작 봐야 할 카드가 묻힌다.
  it('새로 넣은 것이 없으면 알리지 않는다', async () => {
    const { task } = build({
      created: 0,
      alreadyPresent: 33,
      promoted: 0,
      years: [2026, 2027],
      skippedReason: null,
    });

    expect((await task.run(CONTEXT)).skip).toBe(true);
  });

  // 승격만 일어난 회차도 알린다. 남의 줄(사용자가 손으로 넣은 일정)을 고친 것이라
  // 조용히 지나가면 무엇이 바뀌었는지 알 길이 없다.
  it('승격만 있어도 알리고 건수를 따로 밝힌다', async () => {
    const { task } = build({
      created: 0,
      alreadyPresent: 30,
      promoted: 2,
      years: [2026, 2027],
      skippedReason: null,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('2건 승격');
  });

  // 키를 아직 안 붙인 것은 고장이 아니다 — 매주 같은 실패 알람을 내지 않는다.
  it('API 키가 없으면 알림 없이 건너뛴다', async () => {
    const { task } = build({
      created: 0,
      alreadyPresent: 0,
      promoted: 0,
      years: [],
      skippedReason: 'KOREAN_HOLIDAY_API_KEY 가 설정되지 않았습니다.',
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(true);
    expect(result.summaryText).toBeUndefined();
  });
});
