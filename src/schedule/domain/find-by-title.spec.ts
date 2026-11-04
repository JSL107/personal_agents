import { findByTitle } from './find-by-title';
import { ScheduleItemRecord, ScheduleStatus } from './schedule.type';
import { buildScheduleItemRecord } from './schedule-item.fixture';

const item = (
  id: number,
  title: string,
  status = ScheduleStatus.OPEN,
): ScheduleItemRecord => ({
  ...buildScheduleItemRecord(),
  id,
  slackUserId: 'U1',
  title,
  status,
  dueDate: null,
  dueTime: null,
  linkUrl: null,
  memo: null,
  completedAt: null,
  isHoliday: false,
});

describe('findByTitle', () => {
  it('제목을 대소문자 무시 부분 문자열로 찾고 공백·1자 제목은 무시한다', () => {
    expect(
      findByTitle({
        items: [item(1, ' 결제 API '), item(2, 'A')],
        query: '결제 api 내일 3시에 알려줘',
      }),
    ).toMatchObject({ kind: 'ONE', item: { id: 1 } });
  });
  it('둘 이상 일치하면 후보를 돌려주며 완료 업무는 제외한다', () => {
    expect(
      findByTitle({
        items: [
          item(1, '결제 API'),
          item(2, '결제'),
          item(3, '결제 완료', ScheduleStatus.DONE),
        ],
        query: '결제 API 알려줘',
      }),
    ).toMatchObject({ kind: 'MANY', items: [{ id: 1 }, { id: 2 }] });
  });
});
