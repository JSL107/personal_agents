import { HumanizeOptions, HumanizeService } from './humanize.service';
import { humanizeMarkdownProse } from './humanize-markdown.adapter';

const buildHumanizer = (
  transform: (fields: Record<string, string>) => Record<string, string>,
) => {
  // 2인자 시그니처로 선언해야 호출 시 넘긴 options 까지 단언할 수 있다.
  const humanize = jest.fn(
    async (fields: Record<string, string>, options?: HumanizeOptions) => {
      void options;
      return transform(fields);
    },
  );
  return {
    humanizer: { humanize } as unknown as jest.Mocked<HumanizeService>,
    humanize,
  };
};

const markdown = [
  '## 문제',
  '',
  '레거시에서 이렇게 조회했다. 매번 전체를 읽어왔다.',
  '',
  '```php',
  '$row = query("SELECT 1");',
  '',
  '// 위 빈 줄이 블록을 쪼개면 코드가 문단으로 새어 나간다',
  '```',
  '',
  '| 항목 | 값 |',
  '| --- | --- |',
  '| 지연 | 1.2s |',
  '',
  '> 인용은 손대지 않는다',
  '',
  '- 목록도 그대로 둔다',
  '',
  '교훈은 하나다. 원장을 먼저 남긴다.',
].join('\n');

describe('humanizeMarkdownProse — 문단만 윤문', () => {
  it('코드·표·헤딩을 모델에 넘기지 않는다', async () => {
    const { humanizer, humanize } = buildHumanizer((fields) => fields);
    await humanizeMarkdownProse(markdown, humanizer);

    const passed = Object.values(humanize.mock.calls[0][0]).join('\n');
    expect(passed).not.toContain('SELECT 1');
    expect(passed).not.toContain('| 지연 |');
    expect(passed).not.toContain('## 문제');
    expect(passed).not.toContain('> 인용');
    expect(passed).not.toContain('- 목록');
  });

  it('개인 블로그 목소리 + 장문 모드로 호출한다', async () => {
    const { humanizer, humanize } = buildHumanizer((fields) => fields);
    await humanizeMarkdownProse(markdown, humanizer);

    expect(humanize.mock.calls[0][1]).toEqual({
      longForm: true,
      voice: 'personal-blog',
    });
  });

  // 이 테스트가 무손실을 보장한다 — 윤문이 아무것도 바꾸지 않으면 원문과 한 글자도 달라선 안 된다.
  it('윤문이 원문을 그대로 돌려주면 결과도 원문과 완전히 동일하다', async () => {
    const { humanizer } = buildHumanizer((fields) => fields);
    const result = await humanizeMarkdownProse(markdown, humanizer);

    expect(result.markdown).toBe(markdown);
    expect(result.changedParagraphs).toBe(0);
    expect(result.proseParagraphs).toBe(2);
  });

  it('윤문된 문단을 같은 자리에 되끼우고 나머지는 보존한다', async () => {
    const { humanizer } = buildHumanizer((fields) => {
      const next: Record<string, string> = {};
      for (const key of Object.keys(fields)) {
        next[key] = `${fields[key]} 정말이지 그랬거든요.`;
      }
      return next;
    });

    const result = await humanizeMarkdownProse(markdown, humanizer);

    expect(result.changedParagraphs).toBe(2);
    expect(result.markdown).toContain(
      '레거시에서 이렇게 조회했다. 매번 전체를 읽어왔다. 정말이지 그랬거든요.',
    );
    // 코드블록과 표는 글자 그대로
    expect(result.markdown).toContain('$row = query("SELECT 1");');
    expect(result.markdown).toContain('| 지연 | 1.2s |');
    // 문단이 여러 줄로 늘어나도 뒤 블록이 밀리지 않는다
    expect(result.markdown.split('\n').at(-1)).toBe(
      '교훈은 하나다. 원장을 먼저 남긴다. 정말이지 그랬거든요.',
    );
  });

  // J-5(문단 벽) 처방은 모델이 한 값 안에 빈 줄을 넣어 돌려주는 것으로 실현된다.
  // 되끼울 때 줄 수가 늘어나므로, 뒤 블록이 밀려 코드블록을 덮지 않는지가 관건이다.
  it('모델이 빈 줄로 나눠 돌려주면 문단이 쪼개지고 뒤 블록은 밀리지 않는다', async () => {
    const { humanizer } = buildHumanizer((fields) =>
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          value.replace('. ', '.\n\n'),
        ]),
      ),
    );

    const result = await humanizeMarkdownProse(markdown, humanizer);

    expect(result.markdown).toContain(
      '레거시에서 이렇게 조회했다.\n\n매번 전체를 읽어왔다.',
    );
    // 코드·표·인용·목록은 한 줄도 다치지 않는다.
    expect(result.markdown).toContain('$row = query("SELECT 1");');
    expect(result.markdown).toContain('| 지연 | 1.2s |');
    expect(result.markdown).toContain('> 인용은 손대지 않는다');
    expect(result.markdown).toContain('- 목록도 그대로 둔다');
    expect(result.changedParagraphs).toBe(2);
  });

  it('윤문 결과에 빈 값이 오면 그 문단은 원문을 유지한다', async () => {
    const { humanizer } = buildHumanizer((fields) => ({
      ...fields,
      '0': '   ',
    }));

    const result = await humanizeMarkdownProse(markdown, humanizer);

    expect(result.markdown).toContain(
      '레거시에서 이렇게 조회했다. 매번 전체를 읽어왔다.',
    );
    expect(result.changedParagraphs).toBe(0);
  });

  it('산문이 없는 본문은 모델을 호출하지 않는다', async () => {
    const { humanizer, humanize } = buildHumanizer((fields) => fields);
    const codeOnly = '```ts\nconst a = 1;\n```';

    const result = await humanizeMarkdownProse(codeOnly, humanizer);

    expect(humanize).not.toHaveBeenCalled();
    expect(result.markdown).toBe(codeOnly);
    expect(result.proseParagraphs).toBe(0);
  });
});

describe('독자 축 전달', () => {
  const markdown = [
    '# 제목',
    '',
    '첫 문단입니다. 여기에 산문이 있습니다.',
  ].join('\n');

  it('생략하면 humanize 옵션에 audience 가 실리지 않는다', async () => {
    const humanize = jest.fn().mockResolvedValue({ '0': '다듬은 문단입니다.' });
    const humanizer = { humanize } as unknown as HumanizeService;

    await humanizeMarkdownProse(markdown, humanizer);

    expect(humanize.mock.calls[0][1]).toMatchObject({
      longForm: true,
      voice: 'personal-blog',
    });
    expect(humanize.mock.calls[0][1].audience).toBeUndefined();
  });

  it('general 을 넘기면 그대로 humanize 까지 도달한다', async () => {
    // 인자를 받기만 하고 버려도 위 테스트는 통과한다 — 도달 여부는 여기서 지킨다.
    const humanize = jest.fn().mockResolvedValue({ '0': '다듬은 문단입니다.' });
    const humanizer = { humanize } as unknown as HumanizeService;

    await humanizeMarkdownProse(markdown, humanizer, 'general');

    expect(humanize.mock.calls[0][1].audience).toBe('general');
  });
});
