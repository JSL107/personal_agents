import { hostname } from 'node:os';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AI_CLI_ENV_PORT,
  AiCliEnvPort,
} from '../../../ai-cli-env/domain/port/ai-cli-env.port';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class AiCliEnvApplyAutopilotTask implements AutopilotTask {
  readonly id = 'ai-cli-env-apply';

  private readonly logger = new Logger(AiCliEnvApplyAutopilotTask.name);

  constructor(@Inject(AI_CLI_ENV_PORT) private readonly port: AiCliEnvPort) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (!this.port.isEnabled()) {
      this.logger.log('AI_CLI_ENV_SYNC_REPO 미설정으로 skip');
      return { skip: true };
    }
    await this.port.ensureRepository();
    const status = await this.port.readStatus();
    if (!status.available || !status.summary || !status.headSha) {
      this.logger.log('받을 AI CLI 환경 스냅샷이 없어 skip');
      return { skip: true };
    }
    if (status.summary.sourceHost === hostname()) {
      this.logger.log('이 PC가 만든 AI CLI 환경 스냅샷이라 skip');
      return { skip: true };
    }
    if (status.appliedSha === status.headSha) {
      this.logger.log('AI CLI 환경 스냅샷이 이미 적용되어 skip');
      return { skip: true };
    }
    const claude = status.summary.claude;
    const codex = status.summary.codex;
    const sourceDescription = status.summary.sourceHost
      ? `${status.summary.sourceHost} (${status.summary.sourceHome})`
      : `만든 PC를 특정할 수 없다 (구 manifest; sourceHome: ${status.summary.sourceHome})`;
    return {
      skip: false,
      preview: {
        kind: PREVIEW_KIND.AI_CLI_ENV_APPLY,
        payload: { snapshotSha: status.headSha, slackUserId: ownerSlackUserId },
        previewText:
          `🗂️ AI CLI 환경 복원 제안\n` +
          `- 만든 PC: ${sourceDescription}\n` +
          `- 생성 시각: ${status.summary.generatedAt}\n` +
          `- Claude: 플러그인 ${claude?.plugins ?? 0}·MCP ${claude?.mcpServers ?? 0}·자산 ${claude?.assets ?? 0}\n` +
          `- Codex: 플러그인 ${codex?.plugins ?? 0}·MCP ${codex?.mcpServers ?? 0}·자산 ${codex?.assets ?? 0}\n` +
          `- 이 PC의 기존 skills·agents·hooks·전역 지침(CLAUDE.md·AGENTS.md)을 덮어씁니다.\n` +
          `- 덮이는 파일은 .bak-<타임스탬프>로 백업됩니다. hooks는 교체 즉시 이 PC의 기존 훅이 꺼집니다.`,
      },
    };
  }
}
