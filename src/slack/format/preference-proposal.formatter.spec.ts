import { formatPreferenceProposal } from './preference-proposal.formatter';

describe('formatPreferenceProposal', () => {
  it('add/remove 를 사람이 읽게 렌더', () => {
    const text = formatPreferenceProposal(
      { tone: { add: ['간결'] }, doNot: { remove: ['이모지 남발 금지'] } },
      '거부 이력 3건에서 간결 선호 관찰',
    );
    expect(text).toContain('간결');
    expect(text).toContain('거부 이력');
  });

  it('tone add 는 +문체: 로 렌더', () => {
    const text = formatPreferenceProposal(
      { tone: { add: ['간결'] } },
      'test',
    );
    expect(text).toContain('+문체: 간결');
  });

  it('doNot remove 는 -금지: 로 렌더', () => {
    const text = formatPreferenceProposal(
      { doNot: { remove: ['이모지 남발 금지'] } },
      '이유',
    );
    expect(text).toContain('-금지: 이모지 남발 금지');
  });

  it('rationale 가 _근거: ... _ 로 포함', () => {
    const text = formatPreferenceProposal({}, '근거 텍스트');
    expect(text).toContain('_근거: 근거 텍스트_');
  });

  it('verbosity 키-값 렌더', () => {
    const text = formatPreferenceProposal(
      { verbosity: { briefing: 'terse' } },
      'r',
    );
    expect(text).toContain('분량(briefing): terse');
  });

  it('routingHints add 렌더', () => {
    const text = formatPreferenceProposal(
      { routingHints: { add: [{ phrase: '짧게', intent: 'brief' }] } },
      'r',
    );
    expect(text).toContain('+지칭: "짧게" → brief');
  });
});
