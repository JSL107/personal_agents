import {
  HumanizeResearchProposal,
  HumanizeResearchSource,
  ProposalSkipReason,
  ProposalTarget,
} from './humanize-research.type';
import { gateProposal } from './proposal-gate';

const proposal: HumanizeResearchProposal = {
  target: ProposalTarget.CANON,
  file: 'references/quick-rules.md',
  oldString: '| A-1 | 규칙 |',
  newString: '변경',
  targetMetric: '지표',
  rationale: '근거',
  evidence: ['upstream:1'],
};
const context = {
  included: [
    { id: 'upstream:1', source: HumanizeResearchSource.UPSTREAM, text: '' },
    { id: 'blog:1', source: HumanizeResearchSource.BLOG, text: '' },
  ],
  quickRules: '| A-1 | 규칙 |\n**근거 등급과 강도:**',
  blogEditableTexts: ['블로그 문구'],
};
const judge = (
  change: Partial<HumanizeResearchProposal>,
  changes: Partial<typeof context> = {},
) =>
  gateProposal({
    proposal: { ...proposal, ...change },
    context: { ...context, ...changes },
  });

it('정상 정본 제안은 모든 게이트를 통과한다', () => {
  expect(judge({})).toBeNull();
});
it('대상과 근거 출처가 다르면 거절한다', () => {
  expect(judge({ evidence: ['blog:1'] })).toBe(
    ProposalSkipReason.EVIDENCE_SOURCE_MISMATCH,
  );
});
it('정본 제안에 블로그 근거가 섞여도 허용 출처 근거가 있으면 통과한다', () => {
  expect(judge({ evidence: ['blog:1', 'upstream:1'] })).toBeNull();
});
it('허용 파일이 아니면 거절한다', () => {
  expect(judge({ file: 'other' })).toBe(ProposalSkipReason.FILE_NOT_ALLOWED);
});
it('일치가 유일하지 않으면 거절한다', () => {
  expect(judge({}, { quickRules: '| A-1 | 규칙 |\n| A-1 | 규칙 |' })).toBe(
    ProposalSkipReason.MATCH_NOT_UNIQUE,
  );
});
it('블로그 편집 가능 문구 밖이면 거절하고 내부면 통과한다', () => {
  const blog = {
    target: ProposalTarget.BLOG,
    file: 'src/humanize/domain/humanize-system.prompt.ts',
    evidence: ['blog:1'],
  };
  expect(judge({ ...blog, oldString: '없는 문구' })).toBe(
    ProposalSkipReason.OUTSIDE_EDITABLE_SURFACE,
  );
  expect(judge({ ...blog, oldString: '블로그 문구' })).toBeNull();
});
it('표 행이 아닌 삭제를 거절하고 끝 개행이 있든 없든 표 행 삭제를 허용한다', () => {
  expect(judge({ oldString: '규칙', newString: '' })).toBe(
    ProposalSkipReason.DELETE_NOT_ALLOWED,
  );
  expect(judge({ newString: '' })).toBeNull();
  expect(judge({ oldString: '| A-1 | 규칙 |\n', newString: '' })).toBeNull();
});
it('표 행의 앞부분만 지우는 삭제는 거절한다', () => {
  const quickRules = '| A-1 | 정의 | S2 | 처방 |\n**근거 등급과 강도:**';
  expect(
    judge({ oldString: '| A-1 | 정의 |', newString: '' }, { quickRules }),
  ).toBe(ProposalSkipReason.DELETE_NOT_ALLOWED);
  expect(
    judge(
      { oldString: '| A-1 | 정의 | S2 | 처방 |', newString: '' },
      { quickRules },
    ),
  ).toBeNull();
});
it('보호 마커를 거절한다', () => {
  expect(judge({ oldString: '**근거 등급과 강도:**' })).toBe(
    ProposalSkipReason.PROTECTED_ASSET,
  );
});
it('줄 증가가 20을 넘으면 거절한다', () => {
  expect(judge({ newString: 'x\n'.repeat(21) })).toBe(
    ProposalSkipReason.RULEBOOK_TOO_LONG,
  );
  expect(judge({ newString: 'x\n'.repeat(20) })).toBeNull();
});
it('11-16 실제 제안은 통과한다', () => {
  const oldString =
    '6. **인공 표현 자제**: 원문에 없던 비유·수사·문학적 표현을 윤문 과정에서 임의로 추가하지 않았는가';
  expect(judge({ oldString }, { quickRules: oldString })).toBeNull();
});

it('치환 문자열의 달러 패턴은 문자 그대로 줄 수를 계산한다', () => {
  const quickRules = `| A-1 | 규칙 |\n${'line\n'.repeat(15)}`;
  expect(judge({ newString: "$'$'" }, { quickRules })).toBeNull();
});

it('겹치는 일치도 둘이면 정본과 블로그 모두 거절한다', () => {
  expect(judge({ oldString: 'aa' }, { quickRules: 'aaa' })).toBe(
    ProposalSkipReason.MATCH_NOT_UNIQUE,
  );
  expect(
    judge(
      {
        target: ProposalTarget.BLOG,
        file: 'src/humanize/domain/humanize-system.prompt.ts',
        evidence: ['blog:1'],
        oldString: 'aa',
      },
      { blogEditableTexts: ['aaa'] },
    ),
  ).toBe(ProposalSkipReason.MATCH_NOT_UNIQUE);
});

it('보호 단락의 본문 일부만 바꿔도 PROTECTED_ASSET', () => {
  const quickRules = '**보존 신호 (지우지 말 것):** 고유한 본문';
  expect(judge({ oldString: '고유한 본문' }, { quickRules })).toBe(
    ProposalSkipReason.PROTECTED_ASSET,
  );
});
it('등급 기준 절 안의 줄을 바꿔도 PROTECTED_ASSET', () => {
  // 실제 정본 헤딩은 뒤에 설명이 붙는다(quick-rules.md `## 등급 기준 (자가 채점)`).
  const quickRules =
    '## 등급 기준 (자가 채점)\n고유한 등급 본문\n## 다음 절\n일반 규칙';
  expect(judge({ oldString: '고유한 등급 본문' }, { quickRules })).toBe(
    ProposalSkipReason.PROTECTED_ASSET,
  );
});
it('보호 줄 밖 규칙 행은 통과', () => {
  const quickRules = '## 등급 기준\n등급 본문\n## 다음 절\n| A-1 | 규칙 |';
  expect(judge({}, { quickRules })).toBeNull();
});
it('newString 이 공백뿐이어도 표 행이 아니면 DELETE_NOT_ALLOWED', () => {
  expect(judge({ oldString: '규칙', newString: ' \n\t' })).toBe(
    ProposalSkipReason.DELETE_NOT_ALLOWED,
  );
});

it('블로그 리터럴에 위험 문자가 있으면 거절하고 실제 안전 문구는 통과한다', () => {
  const oldString =
    '  - 이중 피동 "~되어진다/~보여진다" → 단일 피동("판단된다") 또는 능동';
  const blog = {
    target: ProposalTarget.BLOG,
    file: 'src/humanize/domain/humanize-system.prompt.ts',
    evidence: ['blog:1'],
    oldString,
  };
  const changes = { blogEditableTexts: [oldString] };
  for (const newString of ['`', "'", '${value}', '\\', '\n', '\r']) {
    expect(judge({ ...blog, newString }, changes)).toBe('UNSAFE_BLOG_LITERAL');
    expect(judge({ ...blog, oldString: newString }, changes)).toBe(
      'UNSAFE_BLOG_LITERAL',
    );
  }
  expect(judge({ ...blog, newString: oldString }, changes)).toBeNull();
});
