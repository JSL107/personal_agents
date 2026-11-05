import {
  ClaimReelInput,
  InstagramPost,
  InstagramPostPatch,
} from '../instagram-post.type';

export const INSTAGRAM_POST_REPOSITORY_PORT = Symbol(
  'INSTAGRAM_POST_REPOSITORY_PORT',
);
export interface InstagramPostRepositoryPort {
  claim(input: ClaimReelInput): Promise<InstagramPost>;
  update(id: string, patch: InstagramPostPatch): Promise<InstagramPost>;
  findByReelKey(reelKey: string): Promise<InstagramPost | null>;
}
