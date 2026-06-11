export const HERMES_RUNNER_PORT = Symbol('HERMES_RUNNER_PORT');

export interface HermesRunResult {
  stdout: string;
  stderr: string;
}

// `hermes -z <prompt>` 를 헤드리스로 실행하고 최종 stdout 을 돌려주는 포트.
// 구현(HermesCliRunner)은 실제 HOME(~/.hermes 접근) + BLOG_NOTIFY_SLACK=0 으로 spawn.
export interface HermesRunnerPort {
  run(prompt: string): Promise<HermesRunResult>;
}
