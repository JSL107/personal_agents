import { createHash } from 'node:crypto';

import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from './intent-classifier-system.prompt';

describe('INTENT_CLASSIFIER_SYSTEM_PROMPT', () => {
  // 워커 설명을 WORKER_CAPABILITIES 로 옮길 때(2026-10-07) 분류기 프롬프트가 한 글자도 바뀌지 않았음을
  // 고정한다. 분류 기준선(2026-09-22, 30/30)과 자연어 eval 기준선이 이 문자열 위에서 잰 값이다.
  // 분류 후보 문구를 일부러 바꿨다면 바뀐 줄을 커밋에 밝히고, 분류 eval 을 다시 잰 뒤 지문을 갱신한다.
  it('분류 후보를 상수에서 조립해도 프롬프트 지문이 2026-10-07 기준과 같다', () => {
    expect(
      createHash('sha256')
        .update(INTENT_CLASSIFIER_SYSTEM_PROMPT)
        .digest('hex'),
    ).toBe('1e52fd1e71e4ea0607cb6cc26eaff7f9ad26e50ecad9e970d267b9b72722ffa5');
  });

  it('SCHEDULE 후보가 분류 표에 있다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('- SCHEDULE:');
  });

  it('PM 의 옛 "일정/계획" 설명이 남아 있지 않다 — 남으면 등록 발화가 PM 으로 샌다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).not.toContain('PM: 일정/계획');
  });

  it('PM 줄이 등록 요청을 SCHEDULE 로 보내라고 명시한다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(/PM 이 아니라 SCHEDULE/);
  });

  it('되묻기 후속 발화를 SCHEDULE 로 잇는 규칙이 있다 — 없으면 날짜만 답할 때 UNKNOWN 으로 샌다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(
      /SCHEDULE\s*\*\*\s*의 후속 입력이다|SCHEDULE\*\* 의 후속 입력이다/,
    );
  });
});
