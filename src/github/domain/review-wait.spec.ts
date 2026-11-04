import { describeReviewWait, ReviewWait } from './review-wait';

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
