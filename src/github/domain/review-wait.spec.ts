import {
  describeQuietPullRequest,
  describeReviewWait,
  ReviewWait,
} from './review-wait';

const ref = { repo: 'owner/repo', number: 42 };

describe('describeReviewWait', () => {
  it('요청 당일은 리뷰 대기로 쓴다', () => {
    const wait: ReviewWait = {
      ref,
      complete: true,
      waits: [{ reviewer: 'alice', requestedAt: '2026-11-04T14:59:00Z' }],
    };

    expect(
      describeReviewWait({ wait, now: new Date('2026-11-04T14:59:59Z') }),
    ).toEqual({
      label: '리뷰 대기',
      days: null,
    });
  });

  it('complete=false 면 일수를 쓰지 않는다', () => {
    const wait: ReviewWait = {
      ref,
      complete: false,
      waits: [{ reviewer: 'alice', requestedAt: '2026-11-01T00:00:00Z' }],
    };

    expect(
      describeReviewWait({ wait, now: new Date('2026-11-04T00:00:00Z') }),
    ).toEqual({
      label: '리뷰 대기',
      days: null,
    });
  });

  it('여러 대기 중 가장 이른 요청으로 KST 달력일을 센다', () => {
    const wait: ReviewWait = {
      ref,
      complete: true,
      waits: [
        { reviewer: 'alice', requestedAt: '2026-11-04T15:01:00Z' },
        { reviewer: 'team', requestedAt: '2026-11-04T14:59:00Z' },
      ],
    };

    expect(
      describeReviewWait({ wait, now: new Date('2026-11-04T15:02:00Z') }),
    ).toEqual({
      label: '리뷰 요청 후 2일째 답 없음',
      days: 2,
    });
  });
});

describe('describeQuietPullRequest', () => {
  const now = new Date('2026-11-09T03:00:00Z');
  it('묶인 PR 중 가장 최근 활동으로 일수를 센다', () => {
    expect(
      describeQuietPullRequest({
        updatedAts: ['2026-06-05T03:00:00Z', '2026-10-01T03:00:00Z'],
        minDays: 14,
        now,
      }),
    ).toEqual({ label: '39일째 움직임 없음', days: 39 });
  });
  it('하나라도 최근에 움직였으면 표시하지 않는다', () => {
    expect(
      describeQuietPullRequest({
        updatedAts: ['2026-06-05T03:00:00Z', '2026-11-08T03:00:00Z'],
        minDays: 14,
        now,
      }),
    ).toBeNull();
  });
});
