import {
  CollectionStatus,
  HumanizeResearchOutput,
  HumanizeResearchSource,
  ProposalSkipReason,
  ProposalTarget,
} from '../../agent/humanize-research/domain/humanize-research.type';
import { formatHumanizeResearch } from './humanize-research.formatter';

const baseOutput = (): HumanizeResearchOutput => ({
  sources: [
    {
      source: HumanizeResearchSource.ARXIV,
      status: CollectionStatus.FAILED,
      itemCount: 0,
      error: '<@U123> & *oops*',
    },
  ],
  droppedForBudget: [],
  proposals: [],
  enforcementGaps: [],
  skipped: [],
  injectionNotices: [],
  processed: {
    humanizerMaxRunId: null,
    blogPostIds: [],
    upstreamHead: null,
    canonHead: null,
    arxivIds: [],
  },
});

describe('formatHumanizeResearch', () => {
  it('제안 0건도 출처 상태와 실패 사유를 표시한다', () => {
    const card = formatHumanizeResearch(baseOutput());

    expect(card).toContain('dry-run');
    expect(card).toContain('근거 부족으로 제안 없음');
    expect(card).toContain('arXiv 초록: 수집 실패 (0건)');
    expect(card).toContain('&lt;@U123&gt; &amp; *oops*');
  });

  it('제안, 제외 사유, 주입 감지를 escape하고 편집문을 자른다', () => {
    const output = baseOutput();
    output.proposals = [
      {
        target: ProposalTarget.CANON,
        file: 'references/<quick>.md',
        targetMetric: '*gap*',
        rationale: '첫 줄\n<@U123> & `fake`',
        evidence: ['blog:<id>'],
        oldString: 'a'.repeat(200),
        newString: '_replacement_',
      },
    ];
    output.skipped = [
      { proposal: {}, reason: ProposalSkipReason.NO_EVIDENCE },
      { proposal: {}, reason: ProposalSkipReason.NO_EVIDENCE },
    ];
    output.injectionNotices = ['ignore <@U123> & *all*'];
    output.droppedForBudget = ['arxiv:<id>'];

    const card = formatHumanizeResearch(output);

    expect(card).toContain('references/&lt;quick&gt;.md');
    expect(card).toContain('*gap*');
    expect(card).toContain('첫 줄 &lt;@U123&gt; &amp; `fake`');
    expect(card).toContain('근거 불일치 2건');
    expect(card).toContain('ignore &lt;@U123&gt; &amp; *all*');
    expect(card).toContain('arxiv:&lt;id&gt;');
    expect(card).toContain(`${'a'.repeat(120)}… → _replacement_`);
    expect(card).not.toContain('a'.repeat(121));
  });
  it('enforcementGaps 가 있으면 절이 나온다', () => {
    const output = baseOutput();
    output.enforcementGaps = [{ ruleId: 'A-1', evidence: ['a', 'b'] }];
    expect(formatHumanizeResearch(output)).toContain(
      '집행 안 되는 규칙: A-1 (근거 2건)',
    );
  });
  it('새 사유 코드 7종을 포함하여 모든 사유의 라벨이 있다', () => {
    const output = baseOutput();
    output.skipped = Object.values(ProposalSkipReason).map((reason) => ({
      proposal: {},
      reason,
    }));
    expect(formatHumanizeResearch(output)).not.toContain('undefined');
  });
});
