import { buildStudyDeepdivePrompt } from './study-deepdive.prompt';

const input = {
  kind: 'CONCEPT' as const,
  topic: 'durable execution',
  verdict: {
    kind: 'CONCEPT' as const,
    whyNow: '워커가 재시작되면 실행이 끊긴다',
    whereItLands: 'agent-run 의 재시도 경로',
    minutes: 15,
  },
  briefMd: '워크플로가 중단돼도 이어서 실행하는 방식이다.',
  sourceUrls: ['https://example.test/docs'],
  repoModules: [{ name: 'agent-run', description: '실행 기록' }],
};

describe('buildStudyDeepdivePrompt', () => {
  it('주제와 조사 요약, 출처, 모듈 이름을 싣는다', () => {
    const prompt = buildStudyDeepdivePrompt(input);

    expect(prompt).toContain('durable execution');
    expect(prompt).toContain('워크플로가 중단돼도');
    expect(prompt).toContain('https://example.test/docs');
    expect(prompt).toContain('agent-run');
  });

  describe('정직성 지시 세 겹', () => {
    // 셋은 서로 다른 실패를 막는다. 하나라도 빠지면 나머지가 그 자리를 메우지 못한다.
    it('확인한 것만 쓰라고 요구한다', () => {
      // 없으면 모델이 수치·API 이름을 지어낸다.
      expect(buildStudyDeepdivePrompt(input)).toContain(
        '출처에서 확인한 것만 쓴다',
      );
    });

    it('문장마다 출처를 밝히지 말라고 요구한다', () => {
      // 위 규칙만 있으면 모델이 출처 뒤에 숨어 옮겨 적은 필기가 된다.
      const prompt = buildStudyDeepdivePrompt(input);

      expect(prompt).toContain('확인했다는 사실을 문장마다 밝히지 마라');
      expect(prompt).toContain('문서는 ~라고 해요');
    });

    it('확인 범위는 글 앞에서 한 번 밝히라고 요구한다', () => {
      // 앞 두 규칙만 있으면 조사해 쓴 글이 겪어 본 이야기로 읽힌다. 8~9월 발행본 11편 중
      // 아홉 편이 그랬고, 2026-08-31 발행본은 사람이 절을 통째로 새로 썼다.
      const prompt = buildStudyDeepdivePrompt(input);

      expect(prompt).toContain('어디까지 확인했는지는 글 앞에서 한 번 밝혀라');
      expect(prompt).toContain('붙여서 돌려 본 글이면');
    });

    it('두 규칙이 어긋나지 않는다는 것을 지시문 안에서 밝힌다', () => {
      // 나란히 두기만 하면 모델이 한쪽만 따른다 — 인용체를 줄인 판이 범위 고지까지 함께
      // 지운 실측이 있다. 둘의 관계를 지시문 안에 적어 두어야 한다.
      expect(buildStudyDeepdivePrompt(input)).toContain(
        '바로 위 규칙과 어긋나지 않는다',
      );
    });
  });

  describe('발행 라인 공통 채점표', () => {
    // 채점표를 생성 단계에 넣어도 수정률이 줄지 않았다는 기존 판정은 이 경로를 재지 않았다.
    // 발행 큐 1순위인 '오늘의 공부' 초안은 채점표를 받은 적이 없다.
    it('내용·근거·전개 항목을 싣는다', () => {
      const prompt = buildStudyDeepdivePrompt(input);

      expect(prompt).toContain(
        '한국어 기술 블로그 통합 채점표의 기준을 따른다',
      );
      expect(prompt).toContain('대안과 트레이드오프');
      expect(prompt).toContain('숫자에는 단위·기간·계산 기준을 붙이고');
    });

    it('문장 호흡 항목은 싣지 않는다', () => {
      // 이 경로는 생성 뒤 humanizeMarkdownProse 를 지난다. 같은 규칙이 윤문 프롬프트
      // (humanize-system.prompt.ts:449-451,461) 에 이미 있어, 여기에도 걸면 두 번 적용된다.
      const prompt = buildStudyDeepdivePrompt(input);

      expect(prompt).not.toContain('문장의 호흡을 무조건 짧게 만들지 않는다');
      expect(prompt).not.toContain(
        '비슷한 생각을 마침표만 붙여 나열하지 않는다',
      );
    });

    it('미확인 값을 지어내지 말되 밝힐 여지는 남긴다', () => {
      // 채점표는 「미확인으로 표시하라」, 기존 지시는 「비워라」였다. 나란히 두면 모델이
      // 한쪽을 버리므로 한 문장으로 합쳤다.
      const prompt = buildStudyDeepdivePrompt(input);

      expect(prompt).toContain('지어내지 마라');
      expect(prompt).toContain('미확인이라고 밝히고');
    });
  });

  it('안 닿으면 안 닿는다고 쓰라고 요구한다', () => {
    // 「어디에 닿는지」만 물으면 모델은 안 닿는 기술도 억지로 이어 붙인다.
    expect(buildStudyDeepdivePrompt(input)).toContain(
      '**안 닿으면 안 닿는다고 써라**',
    );
  });
});
