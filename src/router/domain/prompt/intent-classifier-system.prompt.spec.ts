import { createHash } from 'node:crypto';

import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from './intent-classifier-system.prompt';

describe('INTENT_CLASSIFIER_SYSTEM_PROMPT', () => {
  // 워커 설명을 WORKER_CAPABILITIES 로 옮길 때(2026-10-07) 분류기 프롬프트가 한 글자도 바뀌지 않았음을
  // 고정한다. 분류 기준선(2026-09-22, 30/30)과 자연어 eval 기준선이 이 문자열 위에서 잰 값이다.
  // 분류 후보 문구를 일부러 바꿨다면 바뀐 줄을 커밋에 밝히고, 분류 eval 을 다시 잰 뒤 지문을 갱신한다.
  // 다시 재는 명령: `pnpm eval:classifier`(분류만, 2026-10-16 기준 44/44)와 `pnpm eval:nl-answer`(답까지).
  // 갱신 이력: 2026-10-07 CODE_REVIEWER 에 "링크 없는 게시 지시" 추가(자연어 응답 충실도 4단계).
  //           2026-10-08 SCHEDULE 이 일정 조회도 받는다(자연어 응답 충실도 후속).
  //           2026-10-08 BLOG_PUBLISH 가 발행 여부·초안 목록 질문도 받는다.
  //           2026-10-08 PO_SHADOW 가 분기 제품 목표 선언·조회·닫기도 받는다(PO Shadow 단계 3).
  //           2026-10-14 BLOG 에서 대화·스레드에 이미 있는 내용의 요약·설명 요청을 뺀다(run 8837).
  //           2026-10-15 ART_JOB_FEED(원화 공고 키워드·즉시 수집) 후보와 목록 되묻기 후속 규칙을 넣는다(run 9065~9074).
  //           2026-10-16 ART_JOB_FEED 에서 공고를 빼거나 받는 방법 질문을 뺀다(eval h-thread-art-digest-1014 1/3).
  it('분류기 프롬프트 지문이 마지막으로 잰 값과 같다 — 바꾸면 분류 eval 을 다시 잰다', () => {
    expect(
      createHash('sha256')
        .update(INTENT_CLASSIFIER_SYSTEM_PROMPT)
        .digest('hex'),
    ).toBe('30524ce99a5385be1d60477716dd7c87746af9b0fc0adc652d51a51a7f2ea4d9');
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

  it('원화 공고 키워드와 되묻기 후속 발화를 ART_JOB_FEED 로 분류한다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('- ART_JOB_FEED:');
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('**ART_JOB_FEED**');
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('백엔드 채용공고 추천');
  });
});
