import {
  assertClaimable,
  isClosedWithoutPublish,
} from './instagram-post.policy';
import { InstagramPost, InstagramPostStatus } from './instagram-post.type';
import { ContainerStatusCode } from './port/meta-graph.port';

const post = {
  previewActionId: 'card-1',
  status: InstagramPostStatus.PENDING,
} as InstagramPost;

describe('assertClaimable', () => {
  it('같은 카드가 미게시 행을 다시 맡으면 허용한다', () => {
    expect(() =>
      assertClaimable({ post, previewActionId: 'card-1' }),
    ).not.toThrow();
  });

  it('다른 카드가 미게시 행을 맡으려 하면 거절한다', () => {
    expect(() => assertClaimable({ post, previewActionId: 'card-2' })).toThrow(
      '같은 릴스의 다른 카드가 맡고 있습니다',
    );
  });

  it('게시된 행이면 다른 카드에도 허용한다', () => {
    expect(() =>
      assertClaimable({
        post: { ...post, status: InstagramPostStatus.PUBLISHED },
        previewActionId: 'card-2',
      }),
    ).not.toThrow();
  });
});

describe('isClosedWithoutPublish', () => {
  it('ERROR 와 EXPIRED 는 게시되지 않은 채 끝난 상태로 본다', () => {
    expect(isClosedWithoutPublish(ContainerStatusCode.ERROR)).toBe(true);
    expect(isClosedWithoutPublish(ContainerStatusCode.EXPIRED)).toBe(true);
  });

  it('처리 중·처리 완료·게시됨은 끝난 미게시 상태가 아니다', () => {
    expect(isClosedWithoutPublish(ContainerStatusCode.IN_PROGRESS)).toBe(false);
    expect(isClosedWithoutPublish(ContainerStatusCode.FINISHED)).toBe(false);
    expect(isClosedWithoutPublish(ContainerStatusCode.PUBLISHED)).toBe(false);
  });
});
