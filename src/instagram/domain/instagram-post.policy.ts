import { InstagramException } from './instagram.exception';
import { InstagramErrorCode } from './instagram-error-code.enum';
import { InstagramPost, InstagramPostStatus } from './instagram-post.type';
import { ContainerStatusCode } from './port/meta-graph.port';

export const assertClaimable = ({
  post,
  previewActionId,
}: {
  post: InstagramPost;
  previewActionId: string;
}): void => {
  // 이미 게시된 릴스는 어느 카드가 눌러도 결과만 돌려주면 되므로 막지 않는다.
  const ownedByAnotherCard = post.previewActionId !== previewActionId;
  const alreadyPublished = post.status === InstagramPostStatus.PUBLISHED;
  if (ownedByAnotherCard && !alreadyPublished) {
    throw new InstagramException({
      code: InstagramErrorCode.REEL_CLAIMED,
      message: '같은 릴스의 다른 카드가 맡고 있습니다',
    });
  }
};

// Meta 문서상 ERROR 는 처리 실패, EXPIRED 는 "24시간 안에 게시되지 않음" 이다. 둘 다 게시되지 않은 채
// 끝난 컨테이너라, 새 컨테이너로 다시 시작해도 공개 계정에 두 번 올라가지 않는다.
export const isClosedWithoutPublish = (
  statusCode: ContainerStatusCode,
): boolean =>
  statusCode === ContainerStatusCode.ERROR ||
  statusCode === ContainerStatusCode.EXPIRED;
