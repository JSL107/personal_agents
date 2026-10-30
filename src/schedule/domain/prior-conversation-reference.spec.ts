import { refersToPriorConversation } from './prior-conversation-reference';

describe('refersToPriorConversation', () => {
  it.each([
    '원인과 함께 등록해줘',
    '아까 말한 것',
    '위 내용 정리',
    '방금 그거',
  ])('%s 는 직전 대화 참조다', (text) => {
    expect(refersToPriorConversation(text)).toBe(true);
  });
  it.each(['아까운 돈 정리', '원인불명 사고', '방금전'])(
    '%s 는 참조 낱말이 아니다',
    (text) => {
      expect(refersToPriorConversation(text)).toBe(false);
    },
  );
});
