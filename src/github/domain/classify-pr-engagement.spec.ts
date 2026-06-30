import { classifyPullRequestEngagement } from './classify-pr-engagement';
import { PullRequestEngagementSignals } from './pr-engagement.type';

const base: PullRequestEngagementSignals = {
  repo: 'o/r',
  number: 1,
  title: 't',
  url: 'https://x',
  isApproved: false,
  iAmAuthor: false,
  iAmRequestedReviewer: false,
  iRequestedChanges: false,
  iActedRecently: false,
  mergeableState: 'unknown',
};

describe('classifyPullRequestEngagement', () => {
  it('clean + approved → WAITING 머지만 남음', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      mergeableState: 'clean',
      isApproved: true,
    });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('머지');
  });

  it('내가 변경요청 → WAITING 작성자 응답 대기', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      iRequestedChanges: true,
    });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('변경 요청');
  });

  it('내가 최근 활동 + 요청리뷰어 아님 → WAITING 검토 남김', () => {
    const r = classifyPullRequestEngagement({ ...base, iActedRecently: true });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('검토');
  });

  it('blocked + 요청리뷰어 아님 → WAITING 다른 리뷰어·CI', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      mergeableState: 'blocked',
    });
    expect(r.state).toBe('WAITING');
  });

  it('unstable + author 아님 → WAITING CI 실패', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      mergeableState: 'unstable',
    });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('CI');
  });

  it('요청리뷰어인데 미리뷰(blocked) → ACTIVE (내 차례)', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      mergeableState: 'blocked',
      iAmRequestedReviewer: true,
    });
    expect(r.state).toBe('ACTIVE');
  });

  it('최근 활동했지만 아직 요청리뷰어 → ACTIVE (내 차례)', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      iActedRecently: true,
      iAmRequestedReviewer: true,
    });
    expect(r.state).toBe('ACTIVE');
  });

  it('신호 전부 unknown/false → ACTIVE (기본)', () => {
    expect(classifyPullRequestEngagement(base).state).toBe('ACTIVE');
  });
});
