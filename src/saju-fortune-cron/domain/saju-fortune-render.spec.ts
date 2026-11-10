import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { analyzeSajuDay } from './saju-analysis';
import {
  composeFortuneBody,
  findFortuneViolations,
  FortuneViolation,
  renderItemLine,
  renderStarLine,
  stripInventedMarks,
  truncateByLines,
} from './saju-fortune-render';
import { renderMissionLine } from './saju-mission';

const MISSION = {
  key: 'work-earth-1',
  text: '책상 위 물건 세 개만 제자리에 두기',
};
const ANALYSIS = analyzeSajuDay({
  natalPillars: ['丙子', '辛丑', '己酉', '己巳'],
  todayPillar: '庚午',
});

describe('findFortuneViolations', () => {
  it('일상어와 오행 이름은 걸지 않는다', () => {
    expect(findFortuneViolations('쇠 기운이 반짝이는 날이야')).toEqual([]);
    expect(findFortuneViolations('상관없이 관대하게 목욕하며 쉬어')).toEqual(
      [],
    );
    // "일간"(일주의 천간)은 기간을 뜻하는 일상어 "일주일간·3일간" 과 겹친다.
    expect(findFortuneViolations('일주일간 푹 쉬고 3일간 정리해')).toEqual([]);
    expect(findFortuneViolations('오늘은 일간이 강해')).toEqual([
      FortuneViolation.명리용어,
    ]);
  });

  it('숫자로 쓴 별점도 별점 위반으로 잡는다', () => {
    expect(findFortuneViolations('총운 5점, 돈 2점이야')).toEqual([
      FortuneViolation.별점,
    ]);
  });

  it('용어·한자·AI 가 쓴 별·행운 숫자를 종류별로 한 번씩 잡는다', () => {
    expect(findFortuneViolations('편재가 들어와, 편재야')).toEqual([
      FortuneViolation.명리용어,
    ]);
    expect(findFortuneViolations('己土는 오늘')).toEqual([
      FortuneViolation.한자,
    ]);
    expect(findFortuneViolations('총운 ★★★')).toEqual([FortuneViolation.별점]);
    expect(findFortuneViolations('행운의 숫자 7')).toEqual([
      FortuneViolation.행운숫자,
    ]);
  });
});

describe('stripInventedMarks', () => {
  it('별 문자와 행운 숫자·아이템 줄을 지우고 행운 포인트 줄은 남긴다', () => {
    expect(
      stripInventedMarks(
        '첫 줄\n총운 ★★★★★: 좋아\n행운의 숫자: 7\n🍀 행운 포인트: 산책',
      ),
    ).toBe('첫 줄\n총운: 좋아\n🍀 행운 포인트: 산책');
  });

  it("AI 가 쓴 '미션'·🎯 줄은 표기가 달라도 지운다", () => {
    expect(
      stripInventedMarks(
        '첫 줄\n오늘 미션: 물 마시기\n🎯 할 일: 산책\n오늘의 미션: 정리\n끝 줄',
      ),
    ).toBe('첫 줄\n끝 줄');
  });

  it('미션 줄은 재생성 사유(위반)로 세지 않는다', () => {
    expect(findFortuneViolations('오늘 미션: 물 마시기 🎯')).toEqual([]);
  });
});

describe('truncateByLines', () => {
  it('예산 안의 마지막 완결 줄까지 남긴다', () => {
    expect(truncateByLines({ body: '가나다\n라마바\n사아자', budget: 8 })).toBe(
      '가나다\n라마바',
    );
  });

  it('첫 줄 하나가 예산보다 길면 그 줄을 글자 단위로 자른다', () => {
    expect(truncateByLines({ body: '가'.repeat(20), budget: 5 })).toBe(
      '가'.repeat(5),
    );
  });
});

describe('그리는 줄', () => {
  it('별점 줄은 다섯 항목을 ★☆ 다섯 칸으로 그린다', () => {
    expect(
      renderStarLine({
        총운: 4,
        '일·공부': 3,
        '사람 관계': 5,
        돈: 2,
        컨디션: 3,
      }),
    ).toBe(
      '총운 ★★★★☆ · 일·공부 ★★★☆☆ · 사람 관계 ★★★★★ · 돈 ★★☆☆☆ · 컨디션 ★★★☆☆',
    );
  });

  it('행운 아이템 줄은 색·숫자·맛(음식)·방향이다', () => {
    expect(renderItemLine(ANALYSIS.lucky)).toBe(
      '🍀 행운 아이템: 빨강 · 2 · 쓴맛(자몽) · 남쪽',
    );
  });
});

describe('composeFortuneBody', () => {
  it('라벨 형식과 무관하게 첫 줄 뒤에 별점 줄, 끝에 아이템 줄과 미션 줄을 둔다', () => {
    const { body } = composeFortuneBody({
      body: '오늘은 맑은 날이야.\n\n🌟 **총운:** 좋아\n일·공부: 무난해',
      analysis: ANALYSIS,
      mission: MISSION,
      maximum: 1500,
    });
    const lines = body.split('\n');
    expect(lines[0]).toBe('오늘은 맑은 날이야.');
    expect(lines[1]).toBe(renderStarLine(ANALYSIS.scores));
    expect(lines.at(-2)).toBe(renderItemLine(ANALYSIS.lucky));
    expect(lines.at(-1)).toBe(renderMissionLine(MISSION));
  });

  it('긴 응답도 전체가 예산 안이고 본문 줄은 중간에서 잘리지 않는다', () => {
    const line = '가'.repeat(99);
    const { body } = composeFortuneBody({
      body: Array.from({ length: 20 }, () => line).join('\n'),
      analysis: ANALYSIS,
      mission: MISSION,
      maximum: 1500,
    });
    expect(body.length).toBeLessThanOrEqual(1500);
    const bodyLines = body.split('\n').slice(2, -2);
    for (const kept of bodyLines) {
      expect(kept).toBe(line);
    }
  });

  it('한 줄짜리 긴 응답도 본문이 비지 않는다', () => {
    const { body } = composeFortuneBody({
      body: '가'.repeat(2000),
      analysis: ANALYSIS,
      mission: MISSION,
      maximum: 1500,
    });
    expect(body.split('\n')[0].length).toBeGreaterThan(0);
    expect(body.length).toBeLessThanOrEqual(1500);
  });

  it('escape 뒤에도 그린 줄은 그대로다', () => {
    const escaped = escapeSlackMrkdwn(
      composeFortuneBody({
        body: '맑은 날 & <좋은> 날\n총운: 좋아',
        analysis: ANALYSIS,
        mission: MISSION,
        maximum: 1500,
      }).body,
    );
    expect(escaped).toContain(renderStarLine(ANALYSIS.scores));
    expect(escaped).toContain(renderItemLine(ANALYSIS.lucky));
    expect(escaped).toContain(renderMissionLine(MISSION));
  });

  it('aiBody 는 코드가 그린 줄이 없는 AI 본문이고 발송 본문에 그대로 들어 있다', () => {
    const { body, aiBody } = composeFortuneBody({
      body: '오늘은 맑은 날이야.\n총운: 좋아\n🎯 오늘 미션: 물 마시기',
      analysis: ANALYSIS,
      mission: MISSION,
      maximum: 1500,
    });
    expect(aiBody).toBe('오늘은 맑은 날이야.\n총운: 좋아');
    expect(aiBody).not.toMatch(/[★☆]|🍀|🎯/);
    for (const line of aiBody.split('\n')) {
      expect(body).toContain(line);
    }
  });
});
