import {
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../schedule/domain/schedule.type';
import { formatUpcomingLine } from './schedule-briefing.formatter';

const TODAY = new Date('2026-09-18T00:00:00.000Z');

const item = (
  title: string,
  isoDate: string,
  status = ScheduleStatus.OPEN,
): ScheduleItemRecord => ({
  id: 1,
  slackUserId: 'U1',
  title,
  dueDate: new Date(isoDate),
  dueTime: null,
  linkUrl: null,
  memo: null,
  status,
  completedAt: null,
});

describe('formatUpcomingLine', () => {
  it('항목이 없으면 빈 문자열 — 빈 줄이 매일 나가면 브리핑 신뢰도가 떨어진다', () => {
    expect(formatUpcomingLine([], TODAY)).toBe('');
  });

  it('오늘 마감은 D-day 로 표시한다', () => {
    const line = formatUpcomingLine(
      [item('자동차세', '2026-09-18T00:00:00.000Z')],
      TODAY,
    );
    expect(line).toContain('자동차세');
    expect(line).toContain('D-day');
  });

  it('앞으로 남은 날은 D-n 으로 표시한다', () => {
    const line = formatUpcomingLine(
      [item('건강검진', '2026-09-21T00:00:00.000Z')],
      TODAY,
    );
    expect(line).toContain('D-3');
  });

  it('완료·건너뜀은 싣지 않는다', () => {
    expect(
      formatUpcomingLine(
        [item('끝난 것', '2026-09-18T00:00:00.000Z', ScheduleStatus.DONE)],
        TODAY,
      ),
    ).toBe('');
  });

  it('제목의 제어문자를 이스케이프한다 — 안 하면 Slack 이 링크 태그로 읽어 텍스트가 사라진다', () => {
    const line = formatUpcomingLine(
      [item('A&B <미팅>', '2026-09-18T00:00:00.000Z')],
      TODAY,
    );
    expect(line).toContain('A&amp;B &lt;미팅&gt;');
    expect(line).not.toContain('<미팅>');
  });

  it('지난 마감은 D+n 으로 표시한다 — 음수가 D--n 으로 새지 않는다', () => {
    const line = formatUpcomingLine(
      [item('지난 것', '2026-09-16T00:00:00.000Z')],
      TODAY,
    );
    expect(line).toContain('D+2');
    expect(line).not.toContain('D--');
  });
});
