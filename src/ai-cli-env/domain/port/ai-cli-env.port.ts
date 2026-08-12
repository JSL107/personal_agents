import { SnapshotStatus } from '../ai-cli-env.type';

export const AI_CLI_ENV_PORT = Symbol('AI_CLI_ENV_PORT');

export interface AiCliEnvPort {
  isEnabled(): boolean;
  ensureRepository(): Promise<void>;
  exportSnapshot(): Promise<{ changed: boolean; pushed: boolean }>;
  readStatus(): Promise<SnapshotStatus>;
  applySnapshot(expectedSha: string): Promise<{
    appliedSha: string;
    output: string;
    warnings: string[];
  }>;
}
