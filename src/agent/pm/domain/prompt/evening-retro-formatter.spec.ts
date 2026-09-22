import {
  coerceToEveningRetroReflection,
  formatRetroCarryOverSection,
  formatRetroTryNextSection,
} from './evening-retro-formatter';

// KST 9/18 23:00 에 끝난 저녁 회고 ↔ KST 9/19 09:30 아침 브리핑.
// 시각 차는 10시간 30분뿐이지만 자정을 넘었으므로 "어제" 다.
const RETRO_ENDED_AT = new Date('2026-09-18T14:00:00Z');
const MORNING_NOW = new Date('2026-09-19T00:30:00Z');

describe('coerceToEveningRetroReflection', () => {
  it('원장 output 에서 회고 네 칸을 꺼낸다', () => {
    const reflection = coerceToEveningRetroReflection({
      retrospective: {
        keep: '유지할 것',
        problem: '아쉬운 것',
        tryNext: '다음엔 이렇게',
        carryOver: '못 끝낸 것',
      },
      candidates: [],
      prNotes: [],
    });

    expect(reflection).toEqual({
      keep: '유지할 것',
      problem: '아쉬운 것',
      tryNext: '다음엔 이렇게',
      carryOver: '못 끝낸 것',
    });
  });

  it('malformed / rawText 를 보존한다', () => {
    expect(
      coerceToEveningRetroReflection({
        retrospective: { malformed: true, rawText: '모델 원문' },
      }),
    ).toEqual({ malformed: true, rawText: '모델 원문' });
  });

  it('빈 회고({})는 null 이 아니라 빈 객체다 — "비었다" 와 "못 읽었다" 는 다르다', () => {
    expect(coerceToEveningRetroReflection({ retrospective: {} })).toEqual({});
  });

  it('회고 자리가 없거나 객체가 아니면 null', () => {
    expect(coerceToEveningRetroReflection(null)).toBeNull();
    expect(coerceToEveningRetroReflection('문자열')).toBeNull();
    expect(coerceToEveningRetroReflection([])).toBeNull();
    expect(coerceToEveningRetroReflection({ candidates: [] })).toBeNull();
    expect(
      coerceToEveningRetroReflection({ retrospective: '객체가 아님' }),
    ).toBeNull();
  });

  it('빈 문자열 칸은 키를 떨군다 (모델이 "" 로 칸을 채운 회차)', () => {
    expect(
      coerceToEveningRetroReflection({
        retrospective: { carryOver: '   ', tryNext: '실제 값' },
      }),
    ).toEqual({ tryNext: '실제 값' });
  });
});

describe('formatRetroCarryOverSection', () => {
  it('자정을 넘겼으면 시각 차와 무관하게 "어제" 로 표기한다', () => {
    const section = formatRetroCarryOverSection({
      reflection: { carryOver: '결제 재시도 PR 미완' },
      endedAt: RETRO_ENDED_AT,
      now: MORNING_NOW,
    });

    expect(section).toContain('2026-09-18, 어제');
    expect(section).toContain('결제 재시도 PR 미완');
  });

  it('며칠 지난 회고는 경과일을 적는다 — PM 프롬프트에 오늘 날짜가 없어 이것이 유일한 단서다', () => {
    const section = formatRetroCarryOverSection({
      reflection: { carryOver: '미완' },
      endedAt: RETRO_ENDED_AT,
      now: new Date('2026-09-21T00:30:00Z'),
    });

    expect(section).toContain('3일 전');
  });

  it('UTC 날짜와 KST 날짜가 갈리는 회차도 KST 로 표기한다 — 날짜와 경과일이 같은 달력을 본다', () => {
    // 15:30Z = KST 다음 날 00:30. UTC 날짜(9/21)를 그대로 쓰면 "2026-09-21, 오늘" 처럼
    // 날짜와 라벨이 하루 어긋난다.
    const section = formatRetroCarryOverSection({
      reflection: { carryOver: '미완' },
      endedAt: new Date('2026-09-21T15:30:00Z'),
      now: new Date('2026-09-22T00:30:00Z'),
    });

    expect(section).toContain('2026-09-22, 오늘');
    expect(section).not.toContain('2026-09-21');
  });

  it('carryOver 가 없으면 null', () => {
    expect(
      formatRetroCarryOverSection({
        reflection: { tryNext: '참고만' },
        endedAt: RETRO_ENDED_AT,
        now: MORNING_NOW,
      }),
    ).toBeNull();
  });

  it('폭주한 칸은 상한에서 자른다 — 이 섹션이 마지막까지 남아 다른 섹션을 밀어내는 것을 막는다', () => {
    const section = formatRetroCarryOverSection({
      reflection: { carryOver: '가'.repeat(1_000) },
      endedAt: RETRO_ENDED_AT,
      now: MORNING_NOW,
    });

    expect(section).toContain('…(생략)');
    expect(section?.length).toBeLessThan(700);
  });
});

describe('formatRetroTryNextSection', () => {
  it('tryNext 를 참고 섹션으로 싣는다', () => {
    const section = formatRetroTryNextSection({
      reflection: { tryNext: '리뷰 요청을 오전에 먼저 건다' },
      endedAt: RETRO_ENDED_AT,
      now: MORNING_NOW,
    });

    expect(section).toContain('[저녁 회고 — 다음엔 이렇게');
    expect(section).toContain('리뷰 요청을 오전에 먼저 건다');
    expect(section).toContain('오늘 할 일로 만들지 않는다');
  });

  it('형식을 어긴 회차는 모델 원문을 이 자리에 싣는다', () => {
    const section = formatRetroTryNextSection({
      reflection: { malformed: true, rawText: '파싱 안 된 회고 원문' },
      endedAt: RETRO_ENDED_AT,
      now: MORNING_NOW,
    });

    expect(section).toContain('[저녁 회고 — 형식을 어긴 회차');
    expect(section).toContain('파싱 안 된 회고 원문');
  });

  it('원문 없이 malformed 표식만 있으면 null — 넘길 내용이 없다', () => {
    expect(
      formatRetroTryNextSection({
        reflection: { malformed: true },
        endedAt: RETRO_ENDED_AT,
        now: MORNING_NOW,
      }),
    ).toBeNull();
  });

  it('tryNext 가 있으면 원문보다 우선한다', () => {
    const section = formatRetroTryNextSection({
      reflection: {
        tryNext: '파싱된 개선안',
        malformed: true,
        rawText: '원문',
      },
      endedAt: RETRO_ENDED_AT,
      now: MORNING_NOW,
    });

    expect(section).toContain('파싱된 개선안');
    expect(section).not.toContain('형식을 어긴 회차');
  });
});
