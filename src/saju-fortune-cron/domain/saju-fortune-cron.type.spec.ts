import {
  dailyCronOf,
  parseSajuFortuneRecipients,
} from './saju-fortune-cron.type';

describe('parseSajuFortuneRecipients', () => {
  it('항목·칸·기둥을 나눠 읽는다 (시주 없는 3기둥 허용)', () => {
    const parsed = parseSajuFortuneRecipients(
      ' U111|길동|丙寅 辛卯 壬戌 庚子 ; U222|철수|戊辰 甲寅 癸亥 ',
    );
    expect(parsed.invalidEntryNumbers).toEqual([]);
    expect(parsed.recipients).toEqual([
      {
        slackUserId: 'U111',
        name: '길동',
        natalPillars: ['丙寅', '辛卯', '壬戌', '庚子'],
      },
      {
        slackUserId: 'U222',
        name: '철수',
        natalPillars: ['戊辰', '甲寅', '癸亥'],
      },
    ]);
  });

  it('틀린 항목은 몇 번째인지만 남기고 나머지는 살린다', () => {
    const parsed = parseSajuFortuneRecipients(
      [
        'U111|길동|丙寅 辛卯 壬戌 庚子',
        'U222|철수|甲丑 甲寅 癸亥', // 60갑자에 없는 조합
        'C333|채널|丙寅 辛卯 壬戌', // 사람 ID 아님
        'U444|이름만',
        'U555|기둥둘|丙寅 辛卯',
      ].join(';'),
    );
    expect(parsed.recipients.map((r) => r.slackUserId)).toEqual(['U111']);
    expect(parsed.invalidEntryNumbers).toEqual([2, 3, 4, 5]);
  });

  it('끝의 발송 시각은 생략할 수 있고, 빈 칸은 생략으로 보며, 잘못된 시각은 항목째 뺀다', () => {
    const parsed = parseSajuFortuneRecipients(
      [
        'U111|길동|丙寅 辛卯 壬戌 庚子|07:30',
        'U222|철수|戊辰 甲寅 癸亥|',
        'U333|틀림|戊辰 甲寅 癸亥|24:00',
        'U444|틀림|戊辰 甲寅 癸亥|7:30',
      ].join(';'),
    );
    expect(parsed.recipients).toEqual([
      expect.objectContaining({ slackUserId: 'U111', sendTime: '07:30' }),
      expect.not.objectContaining({ sendTime: expect.anything() }),
    ]);
    expect(parsed.invalidEntryNumbers).toEqual([3, 4]);
  });

  it('미설정이면 빈 목록', () => {
    expect(parseSajuFortuneRecipients(undefined)).toEqual({
      recipients: [],
      invalidEntryNumbers: [],
    });
  });
});

describe('dailyCronOf', () => {
  it('HH:MM 을 매일 그 시각 cron 으로 바꾼다', () => {
    expect(dailyCronOf('07:30')).toBe('30 7 * * *');
    expect(dailyCronOf('00:05')).toBe('5 0 * * *');
  });
});
