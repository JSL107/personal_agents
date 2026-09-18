import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from './intent-classifier-system.prompt';

describe('INTENT_CLASSIFIER_SYSTEM_PROMPT', () => {
  it('SCHEDULE 후보가 분류 표에 있다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('- SCHEDULE:');
  });

  it('PM 의 옛 "일정/계획" 설명이 남아 있지 않다 — 남으면 등록 발화가 PM 으로 샌다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).not.toContain('PM: 일정/계획');
  });

  it('PM 줄이 등록 요청을 SCHEDULE 로 보내라고 명시한다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(/PM 이 아니라 SCHEDULE/);
  });
});
