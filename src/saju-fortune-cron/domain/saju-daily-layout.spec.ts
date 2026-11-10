import { analyzeSajuDay } from './saju-analysis';
import {
  composeFortuneBody,
  renderItemLine,
  renderStarLine,
  starsOf,
} from './saju-fortune-render';

const ANALYSIS = analyzeSajuDay(['丙子', '辛丑', '己酉', '己巳'], '庚午');
const { scores } = ANALYSIS;

const AI_BODY = [
  '오늘은 쉼표를 챙기면 좋은 날이야.',
  '',
  '총운: 계획 전에 한 번 더 생각해 봐.',
  '**일·공부:** 하던 일 하나를 마무리해 봐.',
  '🤝 사람 관계 : 동료에게 필요한 도움을 물어봐.',
  '돈: 살 물건은 장바구니에 담아 두고 다시 골라 봐.',
  '컨디션: 잠깐씩 일어나 몸을 풀어 봐.',
  '',
  '행운 포인트: 머릿속 이야기를 짧게 적어 봐.',
  '오늘의 한 마디: 좋은 이야기는 쉼표를 지나서도 이어져.',
].join('\n');

describe('composeFortuneBody — 항목별 별점 배치', () => {
  it('다섯 항목을 찾으면 굵은 라벨과 별을 항목마다 붙이고 빈 줄로 띄운다', () => {
    const body = composeFortuneBody({
      body: AI_BODY,
      analysis: ANALYSIS,
      maximum: 1_500,
    });

    expect(body).toBe(
      [
        '오늘은 쉼표를 챙기면 좋은 날이야.',
        '',
        `*총운* ${starsOf(scores['총운'])}`,
        '계획 전에 한 번 더 생각해 봐.',
        '',
        `*일·공부* ${starsOf(scores['일·공부'])}`,
        '하던 일 하나를 마무리해 봐.',
        '',
        `*사람 관계* ${starsOf(scores['사람 관계'])}`,
        '동료에게 필요한 도움을 물어봐.',
        '',
        `*돈* ${starsOf(scores['돈'])}`,
        '살 물건은 장바구니에 담아 두고 다시 골라 봐.',
        '',
        `*컨디션* ${starsOf(scores['컨디션'])}`,
        '잠깐씩 일어나 몸을 풀어 봐.',
        '',
        renderItemLine(ANALYSIS.lucky),
        '*행운 포인트:* 머릿속 이야기를 짧게 적어 봐.',
        '*오늘의 한 마디:* 좋은 이야기는 쉼표를 지나서도 이어져.',
      ].join('\n'),
    );
  });

  it('항목 하나라도 못 찾으면 지금처럼 첫 줄 뒤에 별점 줄을 붙인다', () => {
    const body = composeFortuneBody({
      body: AI_BODY.replace('컨디션: ', '몸 상태 — '),
      analysis: ANALYSIS,
      maximum: 1_500,
    });

    expect(body.split('\n')[1]).toBe(renderStarLine(scores));
    expect(body).not.toContain('*총운*');
  });

  it('긴 응답도 예산 안에 들어간다', () => {
    const longBody = AI_BODY.split('\n')
      .map((line) =>
        line.includes(':') ? `${line} ${'가'.repeat(300)}` : line,
      )
      .join('\n');
    const body = composeFortuneBody({
      body: longBody,
      analysis: ANALYSIS,
      maximum: 1_500,
    });

    expect(body.length).toBeLessThanOrEqual(1_500);
    expect(body).toContain(renderItemLine(ANALYSIS.lucky));
  });
});
