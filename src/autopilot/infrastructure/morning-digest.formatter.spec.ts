import {
  formatMorningDigest,
  MorningDigestInput,
} from './morning-digest.formatter';

const input = (
  postings: MorningDigestInput['postings'],
): MorningDigestInput => ({
  firedAtKst: '2026-10-13',
  approvalLabels: [],
  incidents: [],
  postings,
  invest: null,
  company: null,
  study: null,
  portfolio: null,
});

describe('formatMorningDigest — 공고 줄', () => {
  it('한 회사의 공고가 여럿이어도 "외 N" 은 이름을 못 적은 회사 수로 센다', () => {
    const text = formatMorningDigest(
      input([
        { company: 'A사', title: '백엔드' },
        { company: 'A사', title: '플랫폼' },
      ]),
    );
    expect(text).toContain('• *공고 2건* — A사 (목록은 스레드)');
    expect(text).not.toContain('외');
  });

  it('회사가 이름 상한보다 많으면 남은 회사 수만 "외 N" 으로 접는다', () => {
    const text = formatMorningDigest(
      input([
        { company: 'A사', title: '1' },
        { company: 'A사', title: '2' },
        { company: 'B사', title: '3' },
        { company: 'C사', title: '4' },
        { company: 'D사', title: '5' },
      ]),
    );
    expect(text).toContain('• *공고 5건* — A사 · B사 외 2 (목록은 스레드)');
  });
});
