import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import { OpsSupervisorAdvisorPort } from '../../../ops-supervisor/domain/port/ops-supervisor-advisor.port';
import { OPS_SUPERVISOR_SYSTEM_PROMPT } from '../domain/prompt/ops-supervisor-system.prompt';

@Injectable()
export class GenerateOpsAdviceUsecase implements OpsSupervisorAdvisorPort {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async advise({
    anomaliesSummary,
  }: {
    anomaliesSummary: string;
  }): Promise<string> {
    try {
      const outcome = await this.agentRunService.execute({
        agentType: AgentType.OPS_SUPERVISOR,
        triggerType: TriggerType.SCHEDULED,
        inputSnapshot: { anomaliesSummary },
        run: async () => {
          const completion = await this.modelRouter.route({
            agentType: AgentType.OPS_SUPERVISOR,
            request: {
              prompt: anomaliesSummary,
              systemPrompt: OPS_SUPERVISOR_SYSTEM_PROMPT,
            },
          });
          return {
            result: completion.text,
            modelUsed: completion.modelUsed,
            output: { advice: completion.text },
          };
        },
      });
      return outcome.result;
    } catch (error) {
      const quota = this.extractQuota(error);
      if (quota) {
        throw quota;
      }
      throw error;
    }
  }

  private extractQuota(error: unknown): CodexQuotaExceededException | null {
    const seen = new Set<unknown>();
    const stack: unknown[] = [error];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null || seen.has(current)) {
        continue;
      }
      seen.add(current);
      if (current instanceof CodexQuotaExceededException) {
        return current;
      }
      if (typeof current === 'object') {
        const record = current as Record<string, unknown>;
        stack.push(record.cause, record.primaryError, record.lastError);
      }
    }
    return null;
  }
}
