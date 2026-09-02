import { StudyBriefException } from './study-brief.exception';
import { parseStudyDeepdive } from './study-deepdive.parser';

// 파서의 최소 분량(800자)을 넘기는 본문. 하한 자체를 검증하는 케이스는 따로 둔다.
const body = (marker: string): string =>
  `${marker} 이 줄은 분량 하한을 넘기려고 채운 문장이다.\n`.repeat(40);

describe('parseStudyDeepdive', () => {
  it('TITLE / TAGS / 본문을 분리한다', () => {
    const raw = [
      'TITLE: 에이전트 권한 경계 설계',
      'TAGS: llm, security, agent',
      '---',
      '## 어디서 문제가 되나',
      body('본문 문단이다.'),
    ].join('\n');

    const parsed = parseStudyDeepdive(raw);

    expect(parsed.title).toBe('에이전트 권한 경계 설계');
    expect(parsed.tags).toEqual(['llm', 'security', 'agent']);
    // `## ` 는 그대로 둔다 — Notion 왕복이 층을 지키므로 내릴 이유가 없다.
    expect(parsed.bodyMd.startsWith('## 어디서 문제가 되나')).toBe(true);
  });

  it('헤더 앞에 붙은 잡담을 건너뛴다', () => {
    const raw = [
      '조사를 마쳤습니다. 아래가 결과입니다.',
      '',
      'TITLE: 제목',
      'TAGS: a',
      '---',
      body('본문'),
    ].join('\n');

    expect(parseStudyDeepdive(raw).title).toBe('제목');
  });

  it('본문 전체를 감싼 코드펜스는 벗긴다', () => {
    const raw = [
      'TITLE: 제목',
      'TAGS: a',
      '---',
      '```markdown',
      body('본문'),
      '```',
    ].join('\n');

    const parsed = parseStudyDeepdive(raw);

    expect(parsed.bodyMd.startsWith('```')).toBe(false);
    expect(parsed.bodyMd.endsWith('```')).toBe(false);
  });

  // 감싼 펜스를 무조건 벗기면 여기서 닫는 펜스가 사라져 Notion 변환이 통째로 깨진다.
  it('본문이 코드블록으로 끝나면 닫는 펜스를 보존한다', () => {
    const raw = [
      'TITLE: 제목',
      'TAGS: a',
      '---',
      body('본문'),
      '```ts',
      'const a = 1;',
      '```',
    ].join('\n');

    const parsed = parseStudyDeepdive(raw);

    expect(parsed.bodyMd.endsWith('```')).toBe(true);
    expect(parsed.bodyMd).toContain('const a = 1;');
  });

  it('태그는 5개까지, 쉼표는 제거하고 중복은 합친다', () => {
    const raw = [
      'TITLE: 제목',
      'TAGS: a, b, b, c, d, e, f',
      '---',
      body('본문'),
    ].join('\n');

    expect(parseStudyDeepdive(raw).tags).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('TAGS 줄이 없어도 빈 배열로 통과한다', () => {
    const raw = ['TITLE: 제목', '---', body('본문')].join('\n');

    expect(parseStudyDeepdive(raw).tags).toEqual([]);
  });

  it.each([
    ['TITLE 줄이 없으면', ['제목', '---', body('본문')].join('\n')],
    ['--- 구분선이 없으면', ['TITLE: 제목', body('본문')].join('\n')],
    ['TITLE 값이 비면', ['TITLE:', 'TAGS: a', '---', body('본문')].join('\n')],
    [
      '본문이 한 문단뿐이면',
      ['TITLE: 제목', 'TAGS: a', '---', '짧다'].join('\n'),
    ],
  ])('%s 거부한다', (_label, raw) => {
    expect(() => parseStudyDeepdive(raw)).toThrow(StudyBriefException);
  });

  // Notion 왕복(`## ` → heading_2 → `# `)이 소제목마다 h1 을 만드는 것을 막는 정규화.
  // 실측에서 소제목 7개가 전부 `# ` 로 되돌아왔다.
  // 두 층을 보존해야 한다. 예전에는 세 층을 전부 `### ` 로 만들어, 계층을 쓴 글이 발행본에서
  // 한 층으로 평탄화됐다.
  it('h1 만 h2 로 내리고 나머지 층은 그대로 둔다', () => {
    const raw = [
      'TITLE: 제목',
      'TAGS: a',
      '---',
      '# 한 단계',
      '## 두 단계',
      '### 세 단계',
      body('본문'),
    ].join('\n');

    const lines = parseStudyDeepdive(raw).bodyMd.split('\n');

    expect(lines.slice(0, 3)).toEqual([
      '## 한 단계',
      '## 두 단계',
      '### 세 단계',
    ]);
  });

  // 셸·Python 예시의 `# 주석` 이 소제목으로 바뀌면 코드가 깨진다.
  it('코드블록 안의 # 주석은 건드리지 않는다', () => {
    const raw = [
      'TITLE: 제목',
      'TAGS: a',
      '---',
      '## 소제목',
      '```bash',
      '# 이건 주석이다',
      'pnpm test',
      '```',
      body('본문'),
    ].join('\n');

    const bodyMd = parseStudyDeepdive(raw).bodyMd;

    expect(bodyMd).toContain('# 이건 주석이다');
    expect(bodyMd).not.toContain('## 이건 주석이다');
    expect(bodyMd).toContain('## 소제목');
  });
});
