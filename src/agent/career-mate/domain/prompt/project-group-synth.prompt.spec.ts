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
      bullet:
        '흩어진 운영 상태를 한 화면으로 모았다. 크롤 사망 3/6회를 0회로 줄이고 미처리 24,247건의 원인을 규명했다',
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

describe('카드 성과 줄(highlights)', () => {
  const naming = (extra: Record<string, unknown>) => ({
    key: 'jsl107-personal-agents',
    title: '관제 플랫폼',
    summary: '한 문장',
    problem: '문제',
    result: '결과',
    ...extra,
  });

  it('모델이 준 성과 줄을 담는다', () => {
    const parsed = parseProjectGroupOutput(
      body([
        naming({
          highlights: ['크롤 사망 3/6회 → 0회', '미처리 24,247건 규명'],
        }),
      ]),
      [group('jsl107-personal-agents')],
    );

    expect(parsed[0]?.highlights).toEqual([
      '크롤 사망 3/6회 → 0회',
      '미처리 24,247건 규명',
    ]);
  });

  it('성과 줄이 없어도 프로젝트를 버리지 않는다', () => {
    // 수치 근거가 없는 묶음이 실제로 있다. 다섯 필드와 달리 없어도 카드가 성립한다 —
    // 여기서 버리면 저장소 하나가 통째로 발행에서 빠진다.
    const parsed = parseProjectGroupOutput(body([naming({})]), [
      group('jsl107-personal-agents'),
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.highlights).toEqual([]);
  });

  it('40자를 넘는 줄과 4번째부터는 싣지 않는다', () => {
    // 카드 한 줄에 들어가야 한다. 길면 이름표를 밀어내고, 많으면 카드가 목록을 잡아먹는다.
    const parsed = parseProjectGroupOutput(
      body([
        naming({
          highlights: [
            `${'가'.repeat(41)} 3회`,
            '사망 3회 → 0회',
            '미처리 24,247건 규명',
            '사망 6회 관측',
            '사망 0회 유지',
          ],
        }),
      ]),
      [group('jsl107-personal-agents')],
    );

    expect(parsed[0]?.highlights).toEqual([
      '사망 3회 → 0회',
      '미처리 24,247건 규명',
      '사망 6회 관측',
    ]);
  });

  it('배열이 아니거나 빈 문자열이면 무시한다', () => {
    const parsed = parseProjectGroupOutput(
      body([naming({ highlights: '한 줄짜리 문자열' })]),
      [group('jsl107-personal-agents')],
    );

    expect(parsed[0]?.highlights).toEqual([]);
  });
});

describe('근거 없는 성과 줄', () => {
  const withHighlights = (highlights: unknown) => ({
    key: 'jsl107-personal-agents',
    title: '관제 플랫폼',
    summary: '한 문장',
    problem: '문제',
    result: '결과',
    highlights,
  });
  const parse = (highlights: unknown) =>
    parseProjectGroupOutput(body([withHighlights(highlights)]), [
      group('jsl107-personal-agents'),
    ]);

  it('입력에 없는 수치를 지어낸 줄은 버린다', () => {
    // 프롬프트의 "입력에 적힌 수치만" 은 지시일 뿐 강제가 아니다. 한 번 발행되면 갱신
    // 정책상 자동으로 교정되지 않아 근거 없는 성과가 공개 카드에 영구히 남는다.
    expect(parse(['처리량 99% 증가'])[0]?.highlights).toEqual([]);
  });

  it('일부만 근거에 있어도 버린다', () => {
    // "3회" 는 근거에 있지만 "87%" 는 없다. 반쯤 맞는 수치가 더 위험하다.
    expect(parse(['사망 3회, 처리량 87% 개선'])[0]?.highlights).toEqual([]);
  });

  it('PR·커밋 개수는 성과가 아니므로 버린다', () => {
    expect(parse(['8개 PR 진행'])[0]?.highlights).toEqual([]);
    expect(parse(['PR 8건 머지'])[0]?.highlights).toEqual([]);
    expect(parse(['커밋 12개 반영'])[0]?.highlights).toEqual([]);
  });

  it('숫자가 없는 줄은 싣지 않는다', () => {
    // 수치를 싣는 자리이지 문장을 한 번 더 요약하는 자리가 아니다.
    expect(parse(['운영 신뢰성을 높였다'])[0]?.highlights).toEqual([]);
  });

  it('자리 구분 쉼표 표기가 달라도 같은 수치로 본다', () => {
    // 근거는 "24,247건" 인데 모델이 "24247" 로 쓸 수 있다. 표기 차이로 버리면 정당한 줄을 잃는다.
    expect(parse(['미처리 24247건 규명'])[0]?.highlights).toEqual([
      '미처리 24247건 규명',
    ]);
  });

  it('근거에 있는 수치는 그대로 싣는다', () => {
    // 대조군 — 필터가 과하면 기능 자체가 죽는다.
    expect(parse(['크롤 사망 3/6회 → 0회'])[0]?.highlights).toEqual([
      '크롤 사망 3/6회 → 0회',
    ]);
  });
});
