export interface WatchRunnerInput {
  url: string;
  outDir: string;
  homeDir: string;
  // 비슷한 장면을 버리지 않는다. 16×16 축소본으로 비교해서 자막 글자만 바뀐 장면을 중복으로 버린다.
  keepSimilarFrames: boolean;
}

export interface WatchRunnerPort {
  run(input: WatchRunnerInput): Promise<string>;
}

export const WATCH_RUNNER_PORT = Symbol('WATCH_RUNNER_PORT');
