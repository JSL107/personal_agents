export interface WatchRunnerInput {
  url: string;
  outDir: string;
  homeDir: string;
}

export interface WatchRunnerPort {
  run(input: WatchRunnerInput): Promise<string>;
}

export const WATCH_RUNNER_PORT = Symbol('WATCH_RUNNER_PORT');
