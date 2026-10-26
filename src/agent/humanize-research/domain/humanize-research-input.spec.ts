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
  it('예산에서 블로그와 지표를 먼저 유지하고 arXiv를 덜어낸다', () => {
    const selection = selectResearchInput({
      items: [
        item(HumanizeResearchSource.ARXIV, 'arxiv:1', 'a'.repeat(30_000)),
        item(HumanizeResearchSource.HUMANIZER, 'humanizer:1-2', 'signal'),
        item(HumanizeResearchSource.BLOG, 'blog:post', 'b'.repeat(30_000)),
      ],
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
        arxivIds: [],
      },
      included: [item(HumanizeResearchSource.BLOG, 'blog:post', 'text')],
    });
    expect(processed).toEqual({
      humanizerMaxRunId: '2',
      blogPostIds: ['blog:post'],
      upstreamHead: null,
      arxivIds: [],
    });
  });

  it('upstream 처리 기록은 실린 항목의 커밋(마지막으로 실은 커밋)으로만 전진한다', () => {
    const previous = {
      humanizerMaxRunId: null,
      blogPostIds: [],
      upstreamHead: 'a1',
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
