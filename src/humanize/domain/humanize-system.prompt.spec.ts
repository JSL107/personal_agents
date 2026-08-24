import {
  HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT,
  HUMANIZE_PERSONAL_BLOG_TONE,
  HUMANIZE_REPORT_TONE_LINE,
  HUMANIZE_SYSTEM_PROMPT,
} from './humanize-system.prompt';

describe('개인 블로그 목소리 프롬프트', () => {
  // 이 두 단언이 "치환이 실제로 일어났는가" 를 지킨다. 원문 문구가 바뀌어 replace 가
  // 조용히 실패하면(= 보고체 라인이 그대로 남으면) 여기서 FAIL 한다.
  it('보고체 지시를 남기지 않는다', () => {
    expect(HUMANIZE_SYSTEM_PROMPT).toContain(HUMANIZE_REPORT_TONE_LINE);
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).not.toContain(
      HUMANIZE_REPORT_TONE_LINE,
    );
  });

  it('개인 문체 블록으로 갈아끼운다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(
      HUMANIZE_PERSONAL_BLOG_TONE,
    );
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).not.toBe(
      HUMANIZE_SYSTEM_PROMPT,
    );
  });

  it('사실 불변 규칙과 출력 규칙은 그대로 유지한다', () => {
    for (const rule of [
      '의미·사실·주장·인과관계를 바꾸지 마라',
      '숫자, 고유명사, #PR번호, URL, 코드 식별자, 영문 약어는 한 글자도 바꾸지 마라',
      'JSON 객체 하나만 출력',
    ]) {
      expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(rule);
    }
  });

  it('프로파일 실측 지표를 지시문으로 담고 있다', () => {
    for (const marker of [
      '20자 이하',
      '80자',
      '~거든요',
      '또한',
      '비유',
      '제 주관이에요',
    ]) {
      expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain(marker);
    }
  });

  // 전역 비율 지시("열 문장에 한두 번")는 모델이 글 전체를 세야 해서 장문에서 안 지켜졌다
  // (실측 3~5%). 값 단위로 바꾸자 16~23% 가 됐다. 되돌아가면 말투가 조용히 사라진다.
  it('구어 종결어미를 전역 비율이 아니라 값 단위로 요구한다', () => {
    // 값 단위 지시는 유지한다 — 전역 비율로 주면 장문에서 3~5% 로 떨어진다(실측).
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(
      '값 두세 개에 한 문장',
    );
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).not.toContain(
      '열 문장에 한두 번',
    );
  });

  it('값마다 넣지 말라는 상한을 함께 요구한다', () => {
    // 하한만 주면 반대쪽으로 넘어간다. "값마다 하나" 로 주자 문단이 43개로 나뉜 글에서 구어
    // 어미가 30% 가 됐고 그중 28개가 `~죠` 였다 — 프로파일 상한은 20% 다.
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(
      '모든 값에 넣지 마라',
    );
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(
      '한 어미에 몰지 말고',
    );
  });
  // 블로그 글은 해요체가 기본이라는 사용자 진술(2026-08-24)을 고정한다. 이전 지시는 두 종결체를
  // "한쪽으로 몰리지 않게" 요구했고, 그 결과 모델이 문장마다 갈아타 발행본 교대율이 73~88% 가
  // 됐다(사용자가 손본 발행본 37% · 사용자가 쓴 글 50%). 되살아나면 같은 증상이 재발한다.
  it('해요체를 기본으로 주고, 반반 지시는 남기지 않는다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('기본 종결은');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('해요체');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('절반을 넘기지 마라');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).not.toContain(
      '둘의 비율이 한쪽으로 몰리지 않게',
    );
  });

  // 비율만 지시하면 배치가 망가진다 — 배치 금지를 함께 줘야 한다.
  it('종결체를 한 문장씩 번갈아 쓰지 말라고 요구한다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('한 문장씩 번갈아 쓰지 마라');
  });
});
