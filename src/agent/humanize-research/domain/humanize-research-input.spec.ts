import { renderBlogEditSummary, summarizeBlogEdits } from './blog-edit-summary';
import { HUMANIZE_RESEARCH_INPUT_LIMIT } from './humanize-research.constant';
import {
  CollectedItem,
  HumanizeResearchSource,
} from './humanize-research.type';
import {
  advanceProcessed,
  selectResearchInput,
} from './humanize-research-input';

const item = (
  source: HumanizeResearchSource,
  id: string,
  text: string,
): CollectedItem => ({
  id,
  source,
  text,
});

describe('humanize research input', () => {
  it('CANON_LOG 항목이 포함되면 canonHead 가 그 해시로 전진한다', () => {
    const previous = {
      humanizerMaxRunId: null,
      blogPostIds: [],
      upstreamHead: null,
      canonHead: null,
      arxivIds: [],
    };
    const result = advanceProcessed({
      previous,
      included: [
        item('CANON_LOG' as HumanizeResearchSource, 'canon:abc', 'log'),
      ],
    });
    expect(result).toHaveProperty('canonHead', 'abc');
  });

  it('우선순위 BLOG → HUMANIZER → CANON_LOG → UPSTREAM → ARXIV', () => {
    const sources = [
      'ARXIV',
      'UPSTREAM',
      'CANON_LOG',
      'HUMANIZER',
      'BLOG',
    ] as HumanizeResearchSource[];
    const selection = selectResearchInput({
      items: sources.map((source) => item(source, source, 'text')),
      blogSurface: '',
      quickRules: '',
      systemPrompt: '',
    });
    expect(selection.included.map((entry) => entry.source)).toEqual(
      [...sources].reverse(),
    );
  });

  it('블로그 14건 요약은 예산 절반 이하를 쓰고 탈락하지 않는다', () => {
    const changes = {
      removedLines: Array.from(
        { length: 30 },
        (_, index) => `문장 ${index}, 내용을 처리하고 저장한다`,
      ),
      addedLines: Array.from(
        { length: 30 },
        (_, index) => `문장 ${index} 내용을 처리하고 저장한다`,
      ),
    };
    const summary = summarizeBlogEdits(changes);
    const items = Array.from({ length: 14 }, (_, index) =>
      item(
        HumanizeResearchSource.BLOG,
        `blog:${index}`,
        renderBlogEditSummary({ path: `post-${index}`, summary }),
      ),
    );
    const quickRules = '규'.repeat(13_182);
    const systemPrompt = 'system';
    const prefix = selectResearchInput({
      items: [],
      quickRules,
      systemPrompt,
      blogSurface: '',
    }).prompt.length;
    const selection = selectResearchInput({
      items,
      quickRules,
      systemPrompt,
      blogSurface: '',
    });
    expect(selection.droppedForBudget).toEqual([]);
    expect(selection.prompt.length - prefix).toBeLessThanOrEqual(
      (HUMANIZE_RESEARCH_INPUT_LIMIT - prefix - systemPrompt.length) / 2,
    );
  });

  it('예산에서 블로그와 지표를 먼저 유지하고 arXiv를 덜어낸다', () => {
    const selection = selectResearchInput({
      items: [
        item(HumanizeResearchSource.ARXIV, 'arxiv:1', 'a'.repeat(30_000)),
        item(HumanizeResearchSource.HUMANIZER, 'humanizer:1-2', 'signal'),
        item(HumanizeResearchSource.BLOG, 'blog:post', 'b'.repeat(30_000)),
      ],
      blogSurface: '',
      quickRules: 'rules',
      systemPrompt: 'system',
    });
    expect(selection.included.map((entry) => entry.id)).toEqual([
      'blog:post',
      'humanizer:1-2',
    ]);
    expect(selection.droppedForBudget).toEqual(['arxiv:1']);
    expect(selection.prompt.length + 'system'.length).toBeLessThanOrEqual(
      HUMANIZE_RESEARCH_INPUT_LIMIT,
    );
  });

  it('프롬프트에 안 실린 항목은 처리 기록을 전진시키지 않는다', () => {
    const processed = advanceProcessed({
      previous: {
        humanizerMaxRunId: '2',
        blogPostIds: [],
        upstreamHead: null,
        canonHead: null,
        arxivIds: [],
      },
      included: [item(HumanizeResearchSource.BLOG, 'blog:post', 'text')],
    });
    expect(processed).toEqual({
      humanizerMaxRunId: '2',
      blogPostIds: ['blog:post'],
      upstreamHead: null,
      canonHead: null,
      arxivIds: [],
    });
  });

  it('upstream 처리 기록은 실린 항목의 커밋(마지막으로 실은 커밋)으로만 전진한다', () => {
    const previous = {
      humanizerMaxRunId: null,
      blogPostIds: [],
      upstreamHead: 'a1',
      canonHead: null,
      arxivIds: [],
    };

    const advanced = advanceProcessed({
      previous,
      included: [item(HumanizeResearchSource.UPSTREAM, 'upstream:b2', 'diff')],
    });
    const notIncluded = advanceProcessed({ previous, included: [] });

    expect(advanced.upstreamHead).toBe('b2');
    expect(notIncluded.upstreamHead).toBe('a1');
  });
});

it('prefix 에 블로그 편집 가능 문구가 들어간다', () => {
  const result = selectResearchInput({
    items: [],
    quickRules: '',
    systemPrompt: '',
    blogSurface: '블로그 편집 가능 문구:\n- 문구',
  });
  expect(result.prompt).toContain('블로그 편집 가능 문구:\n- 문구');
});
