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
  isHoliday = false,
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
  isHoliday,
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

  // 머리글은 「마감」 이다. 「다가오는」 을 되살리면 지난 마감(`D+n`)이 같은 줄에 섞이는 지금
  // 구조에서 줄의 절반이 거짓이 된다 — 조회 하한을 걷어낸 것과 한 몸인 문구라 여기서 막는다.
  // 공휴일은 아무도 완료를 누르지 않아 영원히 OPEN 으로 남는다. 이 줄은 하한 없이 지난
  // 미완까지 싣는 것이 목적이라, 거르지 않으면 해가 갈수록 공휴일만 끝없이 쌓인다.
  it('공휴일은 싣지 않는다 — 완료되지 않는 항목이라 지난 것이 무한히 쌓인다', () => {
    expect(
      formatUpcomingLine(
        [item('추석', '2026-09-25T00:00:00.000Z', ScheduleStatus.OPEN, true)],
        TODAY,
      ),
    ).toBe('');
  });

  it('공휴일만 걸러내고 같은 날 일반 일정은 남긴다', () => {
    const line = formatUpcomingLine(
      [
        item('추석', '2026-09-25T00:00:00.000Z', ScheduleStatus.OPEN, true),
        item('선물 보내기', '2026-09-25T00:00:00.000Z'),
      ],
      TODAY,
    );
    expect(line).toContain('선물 보내기');
    expect(line).not.toContain('추석');
  });

  it('머리글에 "다가오는" 을 쓰지 않는다 — 지난 마감이 같은 줄에 섞이므로 거짓이 된다', () => {
    const line = formatUpcomingLine(
      [item('지난 것', '2026-09-16T00:00:00.000Z')],
      TODAY,
    );
    expect(line).toContain('📌 마감 —');
    expect(line).not.toContain('다가오는');
  });
});
