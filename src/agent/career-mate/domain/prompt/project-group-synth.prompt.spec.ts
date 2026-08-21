import { ProjectGroup } from '../project-group';
import {
  buildProjectGroupPrompt,
  parseProjectGroupOutput,
} from './project-group-synth.prompt';

const group = (key: string, anonymized = false): ProjectGroup => ({
  key,
  repo: anonymized ? 'acme-corp/internal-api' : 'JSL107/personal_agents',
  anonymized,
  accomplishments: [
    {
      title: '관제 콘솔 구축',
      bullet: '흩어진 운영 상태를 한 화면으로 모았다',
      star: {
        situation: '상황',
        task: '과제',
        action: '행동',
        result: '결과',
      },
      techTags: ['TypeScript'],
      evidence: [],
    },
  ],
  techStack: ['TypeScript'],
  period: '2026.06',
  links: {},
});

const body = (items: unknown[]): string => JSON.stringify({ projects: items });

const item = (key: string) => ({
  key,
  title: '이대리 — 멀티 에이전트',
  summary: '한 문장',
  problem: '문제',
  result: '결과',
});

describe('buildProjectGroupPrompt', () => {
  it('익명 묶음에는 저장소 경로를 넣지 않는다', () => {
    // 프롬프트에서 본 이름을 모델이 제목에 흘리면 키·링크를 접어도 그대로 드러난다.
    const prompt = buildProjectGroupPrompt([group('company-abc123', true)]);

    expect(prompt).not.toContain('acme-corp');
    expect(prompt).not.toContain('internal-api');
    expect(prompt).toContain('anonymous: true');
  });

  it('공개 묶음에는 저장소를 밝힌다', () => {
    const prompt = buildProjectGroupPrompt([group('jsl107-personal-agents')]);

    expect(prompt).toContain('JSL107/personal_agents');
  });
});

describe('parseProjectGroupOutput', () => {
  const groups = [group('jsl107-personal-agents')];

  it('코드펜스로 감싼 응답을 읽는다', () => {
    const text = '```json\n' + body([item('jsl107-personal-agents')]) + '\n```';

    const namings = parseProjectGroupOutput(text, groups);

    expect(namings).toHaveLength(1);
    expect(namings[0].title).toBe('이대리 — 멀티 에이전트');
  });

  it('입력에 없는 키는 버린다', () => {
    // 지어낸 키를 받아들이면 어느 저장소에도 속하지 않는 프로젝트가 발행된다.
    const text = body([item('jsl107-personal-agents'), item('지어낸-키')]);

    const namings = parseProjectGroupOutput(text, groups);

    expect(namings.map((naming) => naming.key)).toEqual([
      'jsl107-personal-agents',
    ]);
  });

  it('같은 키가 두 번 오면 첫 항목만 쓴다', () => {
    const text = body([
      item('jsl107-personal-agents'),
      { ...item('jsl107-personal-agents'), title: '나중 것' },
    ]);

    const namings = parseProjectGroupOutput(text, groups);

    expect(namings).toHaveLength(1);
    expect(namings[0].title).toBe('이대리 — 멀티 에이전트');
  });

  it('필드가 하나라도 비면 그 항목을 버린다', () => {
    // 부분 수용하면 제목 없는 카드나 빈 문단이 사이트에 그대로 나간다.
    const text = body([{ ...item('jsl107-personal-agents'), problem: '   ' }]);

    expect(() => parseProjectGroupOutput(text, groups)).toThrow(
      /쓸 수 있는 항목이 없습니다/,
    );
  });

  it('JSON 이 아니면 끊는다', () => {
    expect(() => parseProjectGroupOutput('그냥 설명문', groups)).toThrow(
      /JSON/,
    );
  });

  it('projects 가 배열이 아니면 끊는다', () => {
    expect(() =>
      parseProjectGroupOutput(JSON.stringify({ projects: {} }), groups),
    ).toThrow(/배열/);
  });
});
