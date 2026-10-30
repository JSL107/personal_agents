import { refersToPriorConversation } from './prior-conversation-reference';

describe('refersToPriorConversation', () => {
  it.each([
    '원인과 함께 등록해줘',
    '아까 말한 것',
    '위 내용 정리',
    '방금 그거',
    '그러면 내가 고칠수있게 일정등록해줄래?',
    '그럼 이거 일정으로 잡아줘',
    '이걸 내일 할 일로 등록해줘',
  ])('%s 는 직전 대화 참조다', (text) => {
    expect(refersToPriorConversation(text)).toBe(true);
  });
  it.each([
    '아까운 돈 정리',
    '원인불명 사고',
    '방금전',
    '그러면서 생각났는데',
    '이거야말로',
  ])('%s 는 참조 낱말이 아니다', (text) => {
    expect(refersToPriorConversation(text)).toBe(false);
  });
});
