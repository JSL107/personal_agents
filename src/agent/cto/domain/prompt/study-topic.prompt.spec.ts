import { CtoException } from '../cto.exception';
import {
  buildStudyTopicPrompt,
  parseStudyVerdict,
  STUDY_CONCEPT_SYSTEM_PROMPT,
  STUDY_TOOL_SYSTEM_PROMPT,
} from './study-topic.prompt';

describe('study topic prompt', () => {
  it('kind별 시스템 프롬프트가 서로 다른 JSON 계약을 요구한다', () => {
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).toContain('whereItLands');
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).not.toContain('readingPlan');
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).not.toContain('installHint');
    expect(STUDY_TOOL_SYSTEM_PROMPT).not.toContain('installHint');
    expect(STUDY_TOOL_SYSTEM_PROMPT).not.toContain('readingPlan');
    expect(STUDY_TOOL_SYSTEM_PROMPT).not.toContain('whereItLands');
  });

  it('verdict 필드별 분량과 단계 나열 금지 제약을 요구한다', () => {
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).toContain('whyNow는 2문장 이내');
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).toContain('whereItLands는 한 줄');
    expect(STUDY_TOOL_SYSTEM_PROMPT).toContain('whatImproves는 2문장 이내');
    expect(STUDY_TOOL_SYSTEM_PROMPT).toContain('adoptionCost는 한 줄');
    expect(STUDY_TOOL_SYSTEM_PROMPT).toContain(
      'caution은 한 줄. 없으면 필드를 생략한다',
    );
    for (const prompt of [
      STUDY_CONCEPT_SYSTEM_PROMPT,
      STUDY_TOOL_SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain(
        '번호 목록(`1. … 2. …`)이나 여러 단계 나열을 어느 필드에도 넣지 마라',
      );
      expect(prompt).toContain('본문 `## 오늘 할 일`의 몫이다');
    }
  });

  it('조사 전문과 프로필 근거를 사용자 프롬프트에 포함한다', () => {
    const prompt = buildStudyTopicPrompt({
      slackUserId: 'U1',
      research: {
        kind: 'CONCEPT',
        topic: 'durable execution',
        sourceUrls: ['https://example.com'],
        reportMd: '조사 전문',
      },
      profileSummary: '백엔드 개발자',
      profileSkills: ['TypeScript(EXPERT)'],
      repoModules: [
        {
          name: 'agent/cto',
          description: '학습 필요성 판정',
        },
      ],
    });

    expect(prompt).toContain('durable execution');
    expect(prompt).toContain('조사 전문');
    expect(prompt).toContain('백엔드 개발자');
    expect(prompt).toContain('TypeScript(EXPERT)');
    expect(prompt).toContain('agent/cto');
    expect(prompt).toContain('학습 필요성 판정');
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).toContain('주어진 모듈 목록 안에서');
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).toContain('목록에 없는 경로');
  });
});

describe('parseStudyVerdict', () => {
  const validConcept = {
    whyNow: '에이전트 재시도 설계에 필요',
    whereItLands: 'src/agent-run/',
    minutes: 30,
  };
  const validTool = {
    whatImproves: '문서 조회 정확도 향상',
    adoptionCost: 'MCP 연결 1건',
    caution: '토큰 발급 필요',
    minutes: 15,
  };

  it('CONCEPT JSON을 discriminated union으로 파싱한다', () => {
    expect(parseStudyVerdict(JSON.stringify(validConcept), 'CONCEPT')).toEqual({
      kind: 'CONCEPT',
      ...validConcept,
    });
  });

  it('TOOL JSON 코드펜스를 파싱한다', () => {
    expect(
      parseStudyVerdict(
        `\`\`\`json\n${JSON.stringify(validTool)}\n\`\`\``,
        'TOOL',
      ),
    ).toEqual({ kind: 'TOOL', ...validTool });
  });

  it.each([
    ['CONCEPT', { ...validConcept, readingPlan: '옛 읽기 순서' }],
    ['TOOL', { ...validTool, installHint: '옛 설치 안내' }],
  ] as const)('%s의 제거된 옛 필드는 무시한다', (kind, value) => {
    const expected =
      kind === 'CONCEPT' ? { kind, ...validConcept } : { kind, ...validTool };
    expect(parseStudyVerdict(JSON.stringify(value), kind)).toEqual(expected);
  });

  it.each([
    ['CONCEPT', { ...validConcept, whyNow: undefined }, 'whyNow'],
    ['CONCEPT', { ...validConcept, whereItLands: 3 }, 'whereItLands'],
    ['TOOL', { ...validTool, whatImproves: undefined }, 'whatImproves'],
    ['TOOL', { ...validTool, adoptionCost: 3 }, 'adoptionCost'],
    ['TOOL', { ...validTool, caution: 3 }, 'caution'],
    ['CONCEPT', { ...validConcept, minutes: '30' }, 'minutes'],
    ['CONCEPT', { ...validConcept, minutes: -1 }, 'minutes'],
    ['CONCEPT', { ...validConcept, minutes: Number.NaN }, 'minutes'],
    ['TOOL', { ...validTool, minutes: 1.5 }, 'minutes'],
  ] as const)(
    '%s 필드 누락·타입·minutes 위반을 원인 메시지와 함께 거부한다',
    (kind, value, reason) => {
      expect(() => parseStudyVerdict(JSON.stringify(value), kind)).toThrow(
        reason,
      );
    },
  );

  it('JSON이 아니면 INVALID_STUDY_VERDICT 예외를 던진다', () => {
    expect(() => parseStudyVerdict('not json', 'TOOL')).toThrow(CtoException);
  });
});
