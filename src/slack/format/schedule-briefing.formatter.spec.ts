import {
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../schedule/domain/schedule.type';
import { buildScheduleItemRecord } from '../../schedule/domain/schedule-item.fixture';
import {
  formatScheduleLines,
  formatTrackingLines,
  formatUpcomingLine,
} from './schedule-briefing.formatter';

const TODAY = new Date('2026-09-18T00:00:00.000Z');

const item = (
  title: string,
  isoDate: string,
  status = ScheduleStatus.OPEN,
  isHoliday = false,
): ScheduleItemRecord => ({
  ...buildScheduleItemRecord(),
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

  it('오늘 마감은 「오늘」 묶음에 싣는다 — 머리글과 겹치는 D-day 표기는 뺀다', () => {
    const line = formatUpcomingLine(
      [item('자동차세', '2026-09-18T00:00:00.000Z')],
      TODAY,
    );
    expect(line).toContain('🟡 *오늘* (1)\n• 자동차세');
    expect(line).not.toContain('D-day');
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
    expect(line).toContain('📌 *마감 1건*');
    expect(line).not.toContain('다가오는');
  });

  it('지남 / 오늘 / 다가옴 으로 묶어 한 건에 한 줄씩 싣는다(같은 묶음 여러 건 포함) — 한 줄로 이으면 열 건 넘는 날 읽을 수 없다', () => {
    const line = formatUpcomingLine(
      [
        item('지난 것', '2026-09-16T00:00:00.000Z'),
        item('어제 것', '2026-09-17T00:00:00.000Z'),
        item('오늘 것', '2026-09-18T00:00:00.000Z'),
        item('다음 것', '2026-09-21T00:00:00.000Z'),
      ],
      TODAY,
    );
    expect(line).toBe(
      [
        '',
        '',
        '📌 *마감 4건*',
        '🔴 *지남* (2)',
        '• 지난 것 `D+2`',
        '• 어제 것 `D+1`',
        '🟡 *오늘* (1)',
        '• 오늘 것',
        '⚪ *다가옴* (1)',
        '• 다음 것 `D-3`',
      ].join('\n'),
    );
  });

  it('빈 묶음은 머리글도 싣지 않는다', () => {
    const line = formatUpcomingLine(
      [item('다음 것', '2026-09-21T00:00:00.000Z')],
      TODAY,
    );
    expect(line).not.toContain('지남');
    expect(line).not.toContain('오늘');
  });
});

describe('업무 추적 브리핑', () => {
  it('마감에는 진행 중을 포함하고 후보와 기한 없는 업무는 제외한다', () => {
    const result = formatUpcomingLine(
      [
        item('진행', '2026-09-18T00:00:00Z', ScheduleStatus.IN_PROGRESS),
        item('후보', '2026-09-18T00:00:00Z', ScheduleStatus.CANDIDATE),
        { ...item('기한 없음', '2026-09-18T00:00:00Z'), dueDate: null },
      ],
      TODAY,
    );
    expect(result).toContain('진행');
    expect(result).not.toContain('후보');
    expect(result).not.toContain('기한 없음');
  });
  it('기한 없는 진행 중 6건은 5건과 나머지 수를 보여준다', () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      ...item(
        `업무${index}`,
        '2026-09-18T00:00:00Z',
        ScheduleStatus.IN_PROGRESS,
      ),
      dueDate: null,
    }));
    const lines = formatTrackingLines({
      undatedInProgress: items,
      candidateCount: 2,
    }).join('\n');
    expect(lines).toContain('진행 중 6건');
    expect(lines).toContain('업무4');
    expect(lines).not.toContain('업무5');
    expect(lines).toContain('외 1건');
    expect(lines).toContain('새 후보 2건');
  });
});

describe('formatScheduleLines', () => {
  it('진행 중도 미완으로 싣고 후보·기한 없음은 뺀다', () => {
    expect(
      formatScheduleLines({
        items: [
          item('진행', '2026-09-18T00:00:00.000Z', ScheduleStatus.IN_PROGRESS),
          item('후보', '2026-09-18T00:00:00.000Z', ScheduleStatus.CANDIDATE),
          { ...item('기한 없음', '2026-09-18T00:00:00.000Z'), dueDate: null },
        ],
        today: TODAY,
      }),
    ).toEqual(['• 진행 (오늘)']);
  });

  it('오늘과 지난 미완 일정만 읽기 쉬운 줄로 낸다', () => {
    expect(
      formatScheduleLines({
        items: [
          { ...item('팀 회의', '2026-09-18T00:00:00.000Z'), dueTime: '14:00' },
          item('이력서 제출', '2026-09-18T00:00:00.000Z'),
          item('보고서 제출', '2026-09-15T00:00:00.000Z'),
          item('내일', '2026-09-19T00:00:00.000Z'),
          item('완료', '2026-09-18T00:00:00.000Z', ScheduleStatus.DONE),
          item('공휴일', '2026-09-18T00:00:00.000Z', ScheduleStatus.OPEN, true),
        ],
        today: TODAY,
      }),
    ).toEqual([
      '• 14:00 팀 회의',
      '• 이력서 제출 (오늘)',
      '• 보고서 제출 (3일 지남)',
    ]);
  });
});
