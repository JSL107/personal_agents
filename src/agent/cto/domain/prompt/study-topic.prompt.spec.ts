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
    expect(STUDY_CONCEPT_SYSTEM_PROMPT).not.toContain('installHint');
    expect(STUDY_TOOL_SYSTEM_PROMPT).toContain('installHint');
    expect(STUDY_TOOL_SYSTEM_PROMPT).not.toContain('whereItLands');
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
    readingPlan: '공식 문서부터 읽기',
    minutes: 30,
  };
  const validTool = {
    whatImproves: '문서 조회 정확도 향상',
    adoptionCost: 'MCP 연결 1건',
    installHint: 'codex mcp add context7',
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
    ['CONCEPT', { ...validConcept, whyNow: undefined }, 'whyNow'],
    ['CONCEPT', { ...validConcept, whereItLands: 3 }, 'whereItLands'],
    ['TOOL', { ...validTool, installHint: undefined }, 'installHint'],
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
