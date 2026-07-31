import { ReviewThread } from '../../github/domain/port/github-client.port';
import { findThreadForComment, resolveHarvestSignal } from './harvest-signal';

const thread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  threadId: 'PRRT_target',
  isResolved: false,
  comments: [
    {
      databaseId: 555,
      authorLogin: 'idaeri-bot',
      body: '리뷰 본문',
      createdAt: '2026-07-31T00:00:00Z',
      reactions: [],
    },
  ],
  ...overrides,
});

const resolve = ({
  targetThread = thread(),
  pullRequestState = 'OPEN',
}: {
  targetThread?: ReviewThread | null;
  pullRequestState?: 'OPEN' | 'CLOSED' | 'MERGED';
} = {}) =>
  resolveHarvestSignal({
    card: { githubCommentId: '555' },
    thread: targetThread,
    ownerLogin: 'owner',
    pullRequestState,
  });

describe('findThreadForComment', () => {
  it('REST comment id가 속한 GraphQL PRRT 스레드를 찾는다', () => {
    const found = findThreadForComment(
      [thread({ threadId: 'PRRT_other' }), thread()],
      '555',
    );

    expect(found?.threadId).toBe('PRRT_other');
  });

  it('숫자가 아닌 comment id는 매핑하지 않는다', () => {
    expect(findThreadForComment([thread()], 'PRRC_wrong')).toBeNull();
  });
});

describe('resolveHarvestSignal', () => {
  it('owner가 봇 코멘트에 THUMBS_UP을 남기면 ACKED다', () => {
    const targetThread = thread({
      comments: [
        {
          ...thread().comments[0],
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        },
      ],
    });

    expect(resolve({ targetThread })).toEqual({
      kind: 'ACKED',
      source: 'REACTION',
      replyBody: null,
    });
  });

  it('owner가 봇 코멘트에 THUMBS_DOWN을 남기면 REJECTED다', () => {
    const targetThread = thread({
      comments: [
        {
          ...thread().comments[0],
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        },
      ],
    });

    expect(resolve({ targetThread })).toEqual({
      kind: 'REJECTED',
      source: 'REACTION',
      replyBody: null,
    });
  });

  it('owner가 THUMBS_DOWN과 답글을 함께 남기면 REJECTED에 답글을 보존한다', () => {
    const targetThread = thread({
      comments: [
        {
          ...thread().comments[0],
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        },
        {
          databaseId: 556,
          authorLogin: 'owner',
          body: '의도된 동작이라 변경하지 않습니다',
          createdAt: '2026-07-31T02:00:00Z',
          reactions: [],
        },
      ],
    });

    expect(resolve({ targetThread })).toEqual({
      kind: 'REJECTED',
      source: 'REACTION',
      replyBody: '의도된 동작이라 변경하지 않습니다',
    });
  });

  it('owner가 THUMBS_UP과 답글을 함께 남기면 답글과 무관하게 ACKED다', () => {
    const targetThread = thread({
      comments: [
        {
          ...thread().comments[0],
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        },
        {
          databaseId: 556,
          authorLogin: 'owner',
          body: '수정했습니다',
          createdAt: '2026-07-31T02:00:00Z',
          reactions: [],
        },
      ],
    });

    expect(resolve({ targetThread })).toEqual({
      kind: 'ACKED',
      source: 'REACTION',
      replyBody: '수정했습니다',
    });
  });

  it('owner의 UP/DOWN이 공존하면 더 늦은 반응을 쓴다', () => {
    const targetThread = thread({
      comments: [
        {
          ...thread().comments[0],
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-07-31T02:00:00Z',
            },
          ],
        },
      ],
    });

    expect(resolve({ targetThread }).kind).toBe('REJECTED');
  });

  it('타인의 반응은 무시하고 owner의 봇 코멘트 이후 답글을 합쳐 판정 요청한다', () => {
    const targetThread = thread({
      comments: [
        {
          ...thread().comments[0],
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'other',
              createdAt: '2026-07-31T03:00:00Z',
            },
          ],
        },
        {
          databaseId: 556,
          authorLogin: 'owner',
          body: '첫 답글',
          createdAt: '2026-07-31T01:00:00Z',
          reactions: [],
        },
        {
          databaseId: 557,
          authorLogin: 'owner',
          body: '둘째 답글',
          createdAt: '2026-07-31T02:00:00Z',
          reactions: [],
        },
      ],
    });

    expect(resolve({ targetThread })).toEqual({
      kind: 'NEEDS_JUDGE',
      replyBody: '첫 답글\n둘째 답글',
    });
  });

  it('봇 코멘트 이전 owner 코멘트와 다른 사람 답글은 무시한다', () => {
    const targetThread = thread({
      comments: [
        {
          databaseId: 554,
          authorLogin: 'owner',
          body: '이전 대화',
          createdAt: '2026-07-30T23:00:00Z',
          reactions: [],
        },
        thread().comments[0],
        {
          databaseId: 556,
          authorLogin: 'other',
          body: '타인 답글',
          createdAt: '2026-07-31T01:00:00Z',
          reactions: [],
        },
      ],
    });

    expect(resolve({ targetThread })).toEqual({ kind: 'NONE' });
  });

  it('신호가 없고 PR이 종료됐으면 STALE이다', () => {
    expect(
      resolve({ targetThread: thread(), pullRequestState: 'MERGED' }),
    ).toEqual({ kind: 'STALE' });
  });

  it('신호가 없고 PR이 열려 있으면 NONE이다', () => {
    expect(resolve()).toEqual({ kind: 'NONE' });
  });

  it('스레드를 못 찾은 열린 PR 카드는 NONE이다', () => {
    expect(resolve({ targetThread: null })).toEqual({ kind: 'NONE' });
  });

  it('스레드를 못 찾은 종료 PR 카드는 STALE이다', () => {
    expect(resolve({ targetThread: null, pullRequestState: 'CLOSED' })).toEqual(
      { kind: 'STALE' },
    );
  });
});
