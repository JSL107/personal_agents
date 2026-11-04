import { AuthorPullRequestSignals } from './author-pr-signals.type';
import { classifyAuthorPullRequestTurn } from './classify-author-pr-turn';

const base: AuthorPullRequestSignals = {
  open: true,
  ref: { repo: 'owner/repo', number: 1 },
  draft: false,
  mergeableState: 'unknown',
  isApproved: false,
  pendingReviewers: [],
  changesRequestedBy: [],
  observed: true,
};

describe('classifyAuthorPullRequestTurn', () => {
  it.each([
    [{ observed: false, draft: true }, 'UNKNOWN', null],
    [{ draft: true }, 'MY_TURN', '드래프트'],
    [{ changesRequestedBy: ['a'] }, 'MY_TURN', '수정 요청 받음'],
    [
      {
        changesRequestedBy: ['a'],
        pendingReviewers: ['a'],
      },
      'WAITING_OTHERS',
      '리뷰 대기',
    ],
    [{ mergeableState: 'dirty' }, 'MY_TURN', '충돌 있음'],
    [{ mergeableState: 'clean', isApproved: true }, 'MY_TURN', '승인됨'],
    [
      { mergeableState: 'behind', isApproved: true },
      'MY_TURN',
      '브랜치 갱신 필요',
    ],
    [{ pendingReviewers: ['a'] }, 'WAITING_OTHERS', '리뷰 대기'],
    [{ mergeableState: 'unstable' }, 'MY_TURN', 'CI 실패'],
    [{ mergeableState: 'blocked' }, 'UNKNOWN', null],
    [{ mergeableState: 'clean' }, 'UNKNOWN', null],
  ] as const)('신호 %j 를 %s 로 분류한다', (overrides, turn, reason) => {
    expect(
      classifyAuthorPullRequestTurn({
        ...base,
        ...overrides,
        pendingReviewers: [
          ...('pendingReviewers' in overrides
            ? overrides.pendingReviewers
            : []),
        ],
        changesRequestedBy: [
          ...('changesRequestedBy' in overrides
            ? overrides.changesRequestedBy
            : []),
        ],
      }),
    ).toEqual({ turn, reason });
  });
});
