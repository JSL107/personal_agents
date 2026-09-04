import {
  HUMANIZE_GENERAL_AUDIENCE_TERM_LINE,
  HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT,
  HUMANIZE_PERSONAL_BLOG_TONE,
  HUMANIZE_REPORT_TONE_LINE,
  HUMANIZE_SYSTEM_PROMPT,
  HUMANIZE_TERM_PRESERVE_LINE,
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
      '문장 길이',
      '~거든요',
      '또한',
      '비유',
      '제 주관이에요',
    ]) {
      expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain(marker);
    }
  });

  // 구어 종결어미는 빈도나 값 개수로 맞추지 않는다. 필요한 자리에만 섞으라는 방향만 준다.
  it('구어 종결어미를 숫자나 값 개수로 강제하지 않는다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(
      '필요한 자리에만 드물게 섞어라',
    );
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).not.toContain(
      '열 문장에 한두 번',
    );
  });

  it('값마다 넣지 말라는 상한을 함께 요구한다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(
      '모든 문장에 넣지 마라',
    );
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).not.toContain('값 두세 개');
  });
  // 블로그 글은 해요체로 쓴다는 사용자 진술(2026-08-24)과 결정(2026-08-25)을 고정한다.
  //
  // 섞어 쓰기 전제로 배치를 조율한 회차들이 전부 실패했다 — 상한만 지우면 `~습니다` 가 124 → 19개,
  // 하한을 도로 넣으면 교대가 50~76% 로 흔들렸다. 종결이 한 가지면 갈아탈 일이 없어 이 축이 사라진다.
  // 되살아나면(= 두 종결체를 섞으라는 지시가 돌아오면) 교대 문제가 그대로 재발한다.
  it('종결을 해요체로 통일하라고 요구한다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('해요체');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('섞어 쓰지 마라');
    // 값 단위 비율 지시는 「문단 나누기」와 곱해져 교대를 강제한다. 어떤 형태로도 돌아오면 안 된다.
    expect(HUMANIZE_PERSONAL_BLOG_TONE).not.toContain('절반을 넘기지 마라');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).not.toContain(
      '둘의 비율이 한쪽으로 몰리지 않게',
    );
  });

  // 삭제 허가가 없으면 절대 규칙("있는 사실을 빼지도 마라")이 이겨서 정보가 0인 문장도 남는다.
  // 실측(2026-08-25): 같은 글의 원문 → 윤문본에서 볼드 34 → 34 · 따옴표 22 → 22 · 개수 예고
  // 10 → 7 로 삭제가 거의 일어나지 않았다. 「길이 예산」절의 예외 문구와 같은 방식으로 푼다.
  it('정보가 0인 문장을 지우라고 하고, 절대 규칙과의 충돌을 명시적으로 풀어 준다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('정보가 0인 문장은 지워라');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain(
      '개수를 미리 세어 알리는 문장',
    );
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('인용 앞에 붙는 예고와 상찬');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('진행을 중계하는 문장');
    // 이 한 줄이 빠지면 규칙이 있어도 절대 규칙에 막혀 작동하지 않는다.
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('"사실을 빼는 것"이 아니다');
  });

  it('강조 표시를 값 단위로 제한한다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('값 하나에 많아야 한 번');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('처음 나올 때 한 번');
  });

  // 스킬 룰북(`rewriting-playbook.md` J-3)에는 "대시(—) 1문서 1~2회 이하" 가 있었는데 백엔드
  // 프롬프트에는 없어, 발행본에 15개가 들어간 채로 나갔다(2026-08-26: 헤딩 6 · 목록 6 · 본문 3).
  // 규칙이 두 벌로 갈린 자리를 여기서 고정한다. 세는 쪽은 `korean-style-metrics` 의 emDashCount 다.
  //
  // 지시문 자체가 줄표를 쓰면 모델이 규칙보다 본 것을 따라 한다. 그래서 블록 안의 줄표도 함께 걷었고,
  // 남긴 것은 금지 규칙이 드는 예시 하나뿐이다.
  it('줄표를 쓰지 말라고 요구하고, 지시문 자체도 줄표를 쓰지 않는다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('줄표');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('헤딩과 목록 머리말');
    const dashLines = HUMANIZE_PERSONAL_BLOG_TONE.split('\n').filter(
      (line) => line.includes('—') && !line.includes('줄표('),
    );
    expect(dashLines).toEqual([]);
  });

  // 문장 길이와 문단 크기를 숫자로 고정하면 모델이 의미보다 숫자를 먼저 맞춘다. 사용자의
  // 문제는 평균값이 아니라 문장 사이의 흐름이므로, 숫자 기준이 다시 들어오지 않게 고정한다.
  it('이유를 문장에서 끊으라는 지시를 남기지 않는다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).not.toContain(
      '이유는 문장을 끊고 뒤에 던져라',
    );
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain(
      '어미를 넣겠다고 문장을 끊지 마라',
    );
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('~거든요');
  });

  it('문장 길이와 문단 크기를 숫자로 강제하지 않는다', () => {
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain(
      '문장 길이를 일정한 범위에 맞추려고 하지 마라',
    );
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain(
      '문장 수나 글자 수를 맞추려고 자르지 마라',
    );
    expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain('잘게 끊지 마라');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).not.toContain('문단마다 하나 이상');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).not.toContain('40~60자');
    expect(HUMANIZE_PERSONAL_BLOG_TONE).not.toContain('80자를 넘기지 마라');
  });

  it('사용자 네 가지 AI 느낌을 길이 강제가 아닌 흐름 규칙으로 다룬다', () => {
    for (const rule of [
      '문장 길이를 짧게 만드는 것 자체를 목표로 삼지 마라',
      '임의로 줄바꿈하지 마라',
      '짧은 문장 여러 개로 억지로 나열하지 마라',
      '앞 문장의 주어·대상·시간을 다음 문장이 자연스럽게 이어받게 써라',
      '문장 길이 숫자만 보지 말고 문단 전체를',
    ]) {
      expect(HUMANIZE_PERSONAL_BLOG_TONE).toContain(rule);
    }
  });
});

describe('일반 독자 용어 규칙', () => {
  // 치환이 조용히 실패하는 두 경로를 막는다: (a) 프롬프트 본문의 문구가 바뀌어 앵커를 못 찾는 경우,
  // (b) 같은 줄이 여러 번 나와 엉뚱한 자리가 바뀌는 경우. 둘 다 "영어가 그대로 남는" 같은 증상을 낸다.
  it('치환 앵커가 기본 프롬프트에 정확히 한 번 존재한다', () => {
    const occurrences =
      HUMANIZE_SYSTEM_PROMPT.split(HUMANIZE_TERM_PRESERVE_LINE).length - 1;
    expect(occurrences).toBe(1);
  });

  it('개인 블로그 프롬프트에서도 앵커가 살아 있다', () => {
    // 목소리 치환과 독자 치환은 곱해서 적용되므로, 앞 단계가 앵커를 지워버리면 안 된다.
    expect(HUMANIZE_PERSONAL_BLOG_SYSTEM_PROMPT).toContain(
      HUMANIZE_TERM_PRESERVE_LINE,
    );
  });

  it('완화본도 식별자 불변은 유지한다', () => {
    // 풀어 쓰는 것은 설명하는 말이고, 가리키는 이름은 여전히 불변이다.
    for (const kept of ['코드 식별자', '#PR번호', 'URL', '숫자']) {
      expect(HUMANIZE_GENERAL_AUDIENCE_TERM_LINE).toContain(kept);
    }
  });

  it('완화본은 원문에 없는 내용을 지어내지 못하게 막는다', () => {
    expect(HUMANIZE_GENERAL_AUDIENCE_TERM_LINE).toContain(
      '원문에 없는 사실·평가·예시를 지어내면 실패다',
    );
  });
});

describe('완화본이 보호 범위를 좁히지 않는다', () => {
  // 완화본을 손으로 쓰다 보면 예시를 들려다 범위를 좁히기 쉽다(실제로 "제품·기관 고유명사" 로
  // 좁혀 인명·지명이 빠진 적이 있다). 원본이 지키던 항목이 하나라도 사라지면 여기서 FAIL 한다.
  const PROTECTED = ['숫자', '고유명사', '#PR번호', 'URL', '코드 식별자'];

  it.each(PROTECTED)('원본이 지키던 %s 를 완화본도 지킨다', (item) => {
    expect(HUMANIZE_TERM_PRESERVE_LINE).toContain(item);
    expect(HUMANIZE_GENERAL_AUDIENCE_TERM_LINE).toContain(item);
  });

  it('고유명사는 종류를 좁히지 않는다', () => {
    for (const kind of ['인명', '지명', '제품명', '기관명']) {
      expect(HUMANIZE_GENERAL_AUDIENCE_TERM_LINE).toContain(kind);
    }
  });

  it('완화되는 항목은 영문 약어 하나뿐이다', () => {
    // 원본에만 있고 완화본에 없는 항목이 늘어나면 그만큼 보호가 사라진 것이다.
    expect(HUMANIZE_TERM_PRESERVE_LINE).toContain('영문 약어');
    const firstLine = HUMANIZE_GENERAL_AUDIENCE_TERM_LINE.split('\n')[0];
    expect(firstLine).not.toContain('영문 약어');
  });
});
