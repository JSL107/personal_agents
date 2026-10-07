import {
  decideOnFailure,
  formatIncidentDuration,
  normalizeIncidentCause,
} from './alert-incident.policy';

const openedAt = new Date('2026-10-06T14:59:00.000Z');
const incident = {
  openedAt,
  lastSeenAt: openedAt,
  lastNotifiedAt: openedAt,
  resolvedAt: null,
};

describe('alert incident policy', () => {
  it('새 사건과 해결된 사건은 OPEN', () => {
    expect(
      decideOnFailure({ incident: null, key: 'cron:a', now: openedAt }),
    ).toEqual({
      action: 'OPEN',
      expiredPrevious: false,
      dayCount: 1,
    });
    expect(
      decideOnFailure({
        incident: { ...incident, resolvedAt: openedAt },
        key: 'cron:a',
        now: openedAt,
      }).action,
    ).toBe('OPEN');
  });

  it('같은 KST 날짜에는 SILENT, 자정이 지나면 REMIND', () => {
    expect(
      decideOnFailure({
        incident,
        key: 'cron:a',
        now: new Date('2026-10-06T14:59:30.000Z'),
      }).action,
    ).toBe('SILENT');
    expect(
      decideOnFailure({
        incident,
        key: 'cron:a',
        now: new Date('2026-10-06T15:01:00.000Z'),
      }),
    ).toEqual({
      action: 'REMIND',
      expiredPrevious: false,
      dayCount: 2,
    });
  });

  it('claude 인증만 마지막 실패 후 24시간에 만료되고 다른 키는 이어진다', () => {
    const now = new Date(openedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(decideOnFailure({ incident, key: 'claude-auth', now })).toEqual({
      action: 'OPEN',
      expiredPrevious: true,
      dayCount: 1,
    });
    expect(decideOnFailure({ incident, key: 'cron:a', now })).toEqual({
      action: 'REMIND',
      expiredPrevious: false,
      dayCount: 4,
    });
  });

  it('지속 시간을 분·시간·일 단위로 나타낸다', () => {
    expect(formatIncidentDuration(59 * 60 * 1000)).toBe('59분');
    expect(formatIncidentDuration(65 * 60 * 1000)).toBe('1시간 5분');
    expect(formatIncidentDuration(25 * 60 * 60 * 1000)).toBe('1일 1시간');
  });

  it('첫 비어 있지 않은 줄에서 원인을 추출하고 숫자를 정규화한다', () => {
    expect(
      normalizeIncidentCause(
        ' \n모델 호출 실패 (CHATGPT, 312.4s 소요)\n더 보기',
      ),
    ).toBe('모델 호출 실패 (CHATGPT, Ns 소요)');
    expect(normalizeIncidentCause('x'.repeat(250))).toHaveLength(200);
  });
});
