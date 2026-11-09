import { homedir } from 'node:os';
import { join } from 'node:path';

export const INSTAGRAM_CAPTION_MAX_CHARS = 2200;
export const DEFAULT_SKILL_REELS_OUT_ROOT = join(
  homedir(),
  'Desktop',
  'skill-jaengyi-reels',
);
