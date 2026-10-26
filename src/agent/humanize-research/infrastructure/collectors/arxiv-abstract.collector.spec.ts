import { ArxivAbstractCollector } from './arxiv-abstract.collector';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2610.12345v2</id>
    <title>Translationese &amp; prose</title>
    <summary>Abstract.</summary>
    <published>2026-10-20T00:00:00Z</published>
  </entry>
</feed>`;

describe('ArxivAbstractCollector', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('버전을 뗀 id를 기록하고 처리한 논문은 다시 내지 않는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T00:00:00Z'));
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => xml });
    const collector = new ArxivAbstractCollector();
    const previous = {
      humanizerMaxRunId: null,
      blogPostIds: [],
      upstreamHead: null,
      arxivIds: [],
    };
    const first = await collector.collect(previous);
    expect(first.items.map((item) => item.id)).toEqual(['arxiv:2610.12345']);
    const repeated = await collector.collect({
      ...previous,
      arxivIds: ['arxiv:2610.12345'],
    });
    expect(repeated.items).toEqual([]);
  });
});
