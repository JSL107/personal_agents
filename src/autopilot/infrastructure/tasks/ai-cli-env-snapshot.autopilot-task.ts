import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AI_CLI_ENV_PORT,
  AiCliEnvPort,
} from '../../../ai-cli-env/domain/port/ai-cli-env.port';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class AiCliEnvSnapshotAutopilotTask implements AutopilotTask {
  readonly id = 'ai-cli-env-snapshot';

  private readonly logger = new Logger(AiCliEnvSnapshotAutopilotTask.name);

  constructor(@Inject(AI_CLI_ENV_PORT) private readonly port: AiCliEnvPort) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    if (!this.port.isEnabled()) {
      this.logger.log('AI_CLI_ENV_SYNC_REPO 미설정으로 skip');
      return { skip: true };
    }
    const result = await this.port.exportSnapshot();
    if (!result.changed) {
      return { skip: true };
    }
    const status = await this.port.readStatus();
    const claude = status.summary?.claude;
    const codex = status.summary?.codex;
    return {
      skip: false,
      summaryText:
        `🗂️ AI CLI 환경 스냅샷 갱신 — Claude 플러그인 ${claude?.plugins ?? 0}·MCP ${claude?.mcpServers ?? 0} / ` +
        `Codex 플러그인 ${codex?.plugins ?? 0}·MCP ${codex?.mcpServers ?? 0}`,
    };
  }
}
