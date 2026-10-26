import { expandHomePath } from '../../common/util/expand-home-path.util';

export const DEFAULT_HUMANIZE_RULES_REPO_PATH =
  '~/.claude/skills/humanize-korean';

// 빈 문자열 설정도 미설정으로 본다 — `.env` 에 `HUMANIZE_RULES_REPO_PATH=` 만 남은 경우.
export const resolveHumanizeRulesRepoPath = (
  configured: string | undefined,
): string => expandHomePath(configured || DEFAULT_HUMANIZE_RULES_REPO_PATH);
