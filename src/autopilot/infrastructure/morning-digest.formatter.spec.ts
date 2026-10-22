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
  resolvedIncidents: [],
  postings,
  invest: null,
  company: null,
  study: null,
  portfolio: null,
});

const firstLine = (text: string): string => text.split('\n')[0];

describe('formatMorningDigest — 첫 줄', () => {
  it('급한 순서(장애 → 승인 → 공고)로 적고 맨 앞 종류만 이름까지 붙인다', () => {
    const text = formatMorningDigest({
      ...input([{ company: 'A사', title: '백엔드' }]),
      approvalLabels: ['블로그 후보', 'GitHub 발행'],
      incidents: [{ label: '블로그 GitHub 발행 실패', dayCount: 1 }],
    });
    expect(firstLine(text)).toBe(
      '☀️ *10/13(화) 아침* — 🔴 장애: 블로그 GitHub 발행 실패 · ✋ 승인 2 · 공고 1',
    );
  });

  it('장애가 여럿이면 첫 이름 뒤를 "외 N" 으로 접는다', () => {
    const text = formatMorningDigest({
      ...input(null),
      incidents: [
        { label: 'A 실패', dayCount: 1 },
        { label: 'B 실패', dayCount: null },
      ],
    });
    expect(firstLine(text)).toBe(
      '☀️ *10/13(화) 아침* — 🔴 장애 2: A 실패 외 1',
    );
  });

  it('장애가 없으면 승인이 맨 앞에 오고 카드 이름을 적는다', () => {
    const text = formatMorningDigest({
      ...input([{ company: 'A사', title: '1' }]),
      approvalLabels: ['블로그 후보', 'GitHub 발행', '블로그 후보'],
    });
    expect(firstLine(text)).toBe(
      '☀️ *10/13(화) 아침* — ✋ 승인 3 (블로그 후보×2 · GitHub 발행) · 공고 1',
    );
  });

  it('공고만 있으면 회사 이름을 적는다', () => {
    const text = formatMorningDigest(
      input([
        { company: 'A사', title: '1' },
        { company: 'B사', title: '2' },
        { company: 'C사', title: '3' },
      ]),
    );
    expect(firstLine(text)).toBe(
      '☀️ *10/13(화) 아침* — 공고 3: A사 · B사 외 1',
    );
  });

  it('할 일이 없으면 "손댈 것 없음"', () => {
    expect(firstLine(formatMorningDigest(input([])))).toBe(
      '☀️ *10/13(화) 아침* — 손댈 것 없음',
    );
  });
});

describe('formatMorningDigest — 해결 줄', () => {
  it('지난밤 닫힌 사건을 "어제 · 오늘" 아래 한 줄로 싣는다 — 첫 줄 할 일에는 넣지 않는다', () => {
    const text = formatMorningDigest({
      ...input(null),
      resolvedIncidents: ['블로그 GitHub 발행', 'Study Brief Cron'],
    });
    expect(firstLine(text)).toBe('☀️ *10/13(화) 아침* — 손댈 것 없음');
    expect(text).toContain(
      '*어제 · 오늘*\n• ✅ *해결* — 블로그 GitHub 발행 · Study Brief Cron',
    );
  });

  it('해결이 없으면 줄을 내지 않는다', () => {
    expect(formatMorningDigest(input(null))).not.toContain('해결');
  });
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
