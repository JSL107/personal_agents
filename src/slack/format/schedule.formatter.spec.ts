import { ScheduleStatus } from '../../schedule/domain/schedule.type';
import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';
import {
  formatNeedsDate,
  formatScheduleRegistered,
} from './schedule.formatter';

const recordWithTitle = (title: string): ScheduleItemRecord => ({
  id: 1,
  slackUserId: 'U1',
  title,
  dueDate: new Date('2026-09-30T00:00:00.000Z'),
  dueTime: null,
  linkUrl: null,
  memo: null,
  status: ScheduleStatus.OPEN,
  completedAt: null,
});

describe('schedule.formatter', () => {
  it('제목의 제어문자를 이스케이프한다 — 안 하면 Slack 이 <...> 를 링크 태그로 읽어 텍스트가 사라진다', () => {
    const text = formatScheduleRegistered(recordWithTitle('<b> & 정리'));
    expect(text).toContain('&lt;b&gt; &amp; 정리');
    expect(text).not.toContain('<b>');
  });

  it('사용자 제목을 굵게 감싸지 않는다 — 제목 속 별표 하나로 그 줄 렌더가 깨진다', () => {
    const text = formatScheduleRegistered(recordWithTitle('A*B 신청'));
    expect(text).toContain('A*B 신청');
    expect(text).not.toContain('*A*B 신청*');
  });

  it('되묻기 문구도 제목을 이스케이프한다', () => {
    expect(formatNeedsDate('<b> 처리')).toContain('&lt;b&gt; 처리');
  });
});
