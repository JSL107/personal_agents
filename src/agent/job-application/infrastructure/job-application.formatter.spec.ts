import { JobApplicationRecord } from '../domain/job-application.type';
import {
  formatAdded,
  formatApplicationList,
  formatNudge,
  formatUnknownJobApplication,
  formatUpdated,
} from './job-application.formatter';

const makeRecord = (
  override: Partial<JobApplicationRecord> = {},
): JobApplicationRecord => ({
  id: 1,
  slackUserId: 'U1',
  company: '토스',
  role: '백엔드',
  jdUrl: null,
  status: 'APPLIED',
  appliedAt: { year: 2026, month: 6, day: 16 },
  deadline: null,
  nextFollowUpAt: null,
  notes: null,
  createdAt: new Date('2026-06-16T00:00:00Z'),
  ...override,
});

describe('job-application.formatter', () => {
  describe('formatApplicationList', () => {
    it('빈 목록이면 안내 문구', () => {
      const text = formatApplicationList([]);
      expect(text).toContain('지원 내역이 없습니다');
    });

    it('회사·직무·상태를 포함한다', () => {
      const text = formatApplicationList([makeRecord()]);
      expect(text).toContain('토스');
      expect(text).toContain('백엔드');
      expect(text).toContain('지원함');
    });

    it('사용자 입력(회사명)의 mrkdwn control 문자를 escape 한다', () => {
      const text = formatApplicationList([
        makeRecord({ company: '<b>토스</b> & 카카오' }),
      ]);
      expect(text).toContain('&lt;b&gt;토스&lt;/b&gt; &amp; 카카오');
      expect(text).not.toContain('<b>토스</b>');
    });
  });

  describe('formatAdded', () => {
    it('회사명을 포함하고 사용자 입력을 escape 한다', () => {
      const text = formatAdded(makeRecord({ company: 'A<B>C' }));
      expect(text).toContain('A&lt;B&gt;C');
      expect(text).toContain('등록');
    });
  });

  describe('formatUpdated', () => {
    it('회사명·새 상태를 포함하고 escape 한다', () => {
      const text = formatUpdated(
        makeRecord({ company: 'X&Y', status: 'SCREENING' }),
      );
      expect(text).toContain('X&amp;Y');
      expect(text).toContain('서류심사');
    });
  });

  describe('formatNudge', () => {
    it('마감 임박/팔로업 건의 회사명을 포함하고 escape 한다', () => {
      const text = formatNudge([
        makeRecord({
          company: 'Z<script>',
          deadline: { year: 2026, month: 6, day: 18 },
        }),
      ]);
      expect(text).toContain('Z&lt;script&gt;');
      expect(text).toContain('2026-06-18');
    });
  });

  describe('formatUnknownJobApplication', () => {
    it('사용법 안내를 담는다', () => {
      expect(formatUnknownJobApplication()).toContain('지원');
    });
  });
});
