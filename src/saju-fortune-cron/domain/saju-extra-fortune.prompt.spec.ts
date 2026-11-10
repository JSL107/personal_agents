import { dayPillarOf } from './day-pillar';
import {
  buildExtraFortunePrompt,
  expectedSectionCount,
  ExtraFortunePromptInput,
} from './saju-extra-fortune.prompt';
import { SajuFortuneRecipient } from './saju-fortune-cron.type';
import { EXTRA_SECTION_SEPARATOR } from './saju-fortune-render';
import {
  SpecialDayContext,
  SpecialDayKind,
  SpecialSolarTerm,
} from './special-day';
import { DailyScores, WEEKDAYS } from './weekly-fortune';

const recipient: SajuFortuneRecipient = {
  slackUserId: 'U111',
  name: '길동',
  natalPillars: ['丙寅', '辛卯', '壬戌', '庚子'],
  birthday: '05-17',
};

const promptOf = (
  overrides: Partial<ExtraFortunePromptInput> & { todayKst: string },
): string =>
  buildExtraFortunePrompt({
    recipient,
    todayPillar: dayPillarOf(overrides.todayKst),
    nowKst: '07:30',
    specialDays: [],
    context: { ipchun: { date: '2027-02-04', timeKst: '10:46' } },
    ...overrides,
  });

const week: DailyScores[] = WEEKDAYS.map((weekday, index) => ({
  date: `2027-05-${17 + index}`,
  weekday,
  scores: {
    총운: 3,
    '일·공부': 3,
    '사람 관계': 3,
    돈: 3,
    컨디션: index === 1 ? 2 : 3,
  },
}));

describe('buildExtraFortunePrompt', () => {
  it('새해 특집은 지난해 흐름을 싣지 않고 사주의 새해가 입춘부터라고 알린다', () => {
    const prompt = promptOf({
      todayKst: '2027-01-01',
      specialDays: [{ kind: SpecialDayKind.NEW_YEAR }],
    });

    expect(prompt).not.toMatch(/병오/);
    expect(prompt).toContain('사주의 새해는 입춘(2월 4일)부터');
  });

  it('흐름이 바뀌는 절은 절입 시각·절입 직후 흐름·지금 시각을 싣는다', () => {
    const context: SpecialDayContext = {
      solarTermToday: { name: SpecialSolarTerm.입춘, timeKst: '16:31' },
      ipchun: { date: '2028-02-04', timeKst: '16:31' },
      termFlow: { yearPillar: '戊申', monthPillar: '甲寅' },
    };
    const prompt = promptOf({
      todayKst: '2028-02-04',
      context,
      specialDays: [
        { kind: SpecialDayKind.SOLAR_TERM, solarTerm: context.solarTermToday },
      ],
    });

    expect(prompt).toContain('16시 31분');
    expect(prompt).toContain('무신년');
    expect(prompt).toContain('갑인월');
    expect(prompt).toContain('지금 시각: 7시 30분');
  });

  it('중기(춘분)는 시각만 싣고 흐름이 바뀐다고 쓰지 말라고 한다', () => {
    const context: SpecialDayContext = {
      solarTermToday: { name: SpecialSolarTerm.춘분, timeKst: '05:25' },
      ipchun: { date: '2027-02-04', timeKst: '10:46' },
    };
    const prompt = promptOf({
      todayKst: '2027-03-21',
      context,
      specialDays: [
        { kind: SpecialDayKind.SOLAR_TERM, solarTerm: context.solarTermToday },
      ],
    });

    expect(prompt).toContain('5시 25분');
    expect(prompt).toContain('흐름이 바뀐다고 쓰지 않는다');
    expect(prompt).not.toContain('바뀌는 흐름:');
  });

  it('생일은 날짜 없이 "오늘이 생일" 사실만 싣는다', () => {
    const prompt = promptOf({
      todayKst: '2027-05-17',
      specialDays: [{ kind: SpecialDayKind.BIRTHDAY }],
    });

    expect(prompt).not.toMatch(/생일[^\n]*\d{2}-\d{2}/);
    expect(prompt).toContain('오늘은 길동의 생일이다');
  });

  it('월요일+생일이면 구간 2개를 구분줄로 나누라고 하고 주간 사실을 싣는다', () => {
    const prompt = promptOf({
      todayKst: '2027-05-17',
      specialDays: [{ kind: SpecialDayKind.BIRTHDAY }],
      week,
    });

    expect(prompt).toContain(`구간 2개`);
    expect(prompt).toContain(EXTRA_SECTION_SEPARATOR);
    expect(prompt).toContain('- 컨디션: 조심할 날 화요일');
    expect(prompt).toContain('한자를 한 글자도 쓰지 않는다');
  });
});

describe('expectedSectionCount', () => {
  it('특집 수 + 주간 1', () => {
    expect(
      expectedSectionCount({
        specialDays: [{ kind: SpecialDayKind.BIRTHDAY }],
        week,
      }),
    ).toBe(2);
    expect(
      expectedSectionCount({
        specialDays: [{ kind: SpecialDayKind.NEW_YEAR }],
      }),
    ).toBe(1);
  });
});
