export type JobFeedCommand = 'collect' | 'digest' | 'reprocess';

export interface JobFeedCliOptions {
  command: JobFeedCommand;
  dryRun: boolean;
  explain: boolean;
  maxPages: number;
  // reprocess 전용. 채점 표식을 지워 다음 채점이 전량을 다시 매기게 한다.
  // 채점식을 고친 배포 뒤에 한 번 돌린다.
  rescoreAll: boolean;
}

const COMMANDS: ReadonlySet<string> = new Set([
  'collect',
  'digest',
  'reprocess',
]);
const DEFAULT_MAX_PAGES = 3;

export const parseJobFeedCliArguments = (argv: string[]): JobFeedCliOptions => {
  const [first, ...rest] = argv;
  let command: JobFeedCommand = 'collect';
  const flags = [...rest];

  if (first !== undefined && !first.startsWith('--')) {
    if (!COMMANDS.has(first)) {
      throw new Error(
        `알 수 없는 명령입니다: ${first} (collect | digest | reprocess)`,
      );
    }
    command = first as JobFeedCommand;
  } else if (first !== undefined) {
    flags.unshift(first);
  }

  const maxPagesFlag = flags.find((flag) => flag.startsWith('--max-pages='));
  const maxPages =
    maxPagesFlag === undefined
      ? DEFAULT_MAX_PAGES
      : Number.parseInt(maxPagesFlag.split('=')[1] ?? '', 10);

  return {
    command,
    dryRun: flags.includes('--dry-run'),
    explain: flags.includes('--explain'),
    rescoreAll: flags.includes('--rescore-all'),
    maxPages:
      Number.isFinite(maxPages) && maxPages > 0 ? maxPages : DEFAULT_MAX_PAGES,
  };
};
