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

  describe('근거 제시 지시 두 겹', () => {
    // 발행본을 사람이 다시 쓴 양의 무게중심이 근거 층이었다(출처 전수 보강 14편, 2026-09-08).
    // 두 항목은 그 층에서 채점표(docs/korean-it-tech-blog-scorecard.md)와 이 프롬프트의 차집합이다.
    it('숫자에 단위와 적용 조건을 붙이라고 요구한다', () => {
      // 없으면 「30% 빨라졌다」처럼 조건 없는 수치가 나가고, 읽는 사람이 자기 환경에 옮기지 못한다.
      const prompt = buildStudyDeepdivePrompt(input);

      expect(prompt).toContain('숫자에는 단위·기간·계산 기준을 붙여라');
      expect(prompt).toContain('어느 조건에서 나온 것인지');
    });

    it('숫자의 조건 표기가 출처 표기가 아님을 지시문 안에서 밝힌다', () => {
      // 이 지시만 두면 「문장마다 출처를 밝히지 마라」와 경계가 겹쳐, 모델이 숫자 옆에
      // 「문서에 따르면」을 붙인다. 위 정직성 세 겹과 같은 이유로 관계를 지시문 안에 적는다.
      expect(buildStudyDeepdivePrompt(input)).toContain(
        '숫자의 적용 조건이지 출처 표기가 아니다',
      );
    });

    it('고르지 않은 대안과 트레이드오프를 쓰라고 요구한다', () => {
      // 선택지 하나만 설명하면 읽는 사람이 자기 조건에서 반대로 골라야 하는지 판단할 수 없다.
      const prompt = buildStudyDeepdivePrompt(input);

      expect(prompt).toContain('**고르지 않은 쪽도 써라.**');
      expect(prompt).toContain('무엇을 내주고 무엇을 얻는 선택인지');
    });
  });

  it('안 닿으면 안 닿는다고 쓰라고 요구한다', () => {
    // 「어디에 닿는지」만 물으면 모델은 안 닿는 기술도 억지로 이어 붙인다.
    expect(buildStudyDeepdivePrompt(input)).toContain(
      '**안 닿으면 안 닿는다고 써라**',
    );
  });
});
