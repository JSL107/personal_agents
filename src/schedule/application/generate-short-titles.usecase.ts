import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { wrapUntrustedInput } from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { SHORT_TITLE_BATCH_MAX } from '../domain/daily-todo.constant';
import { validateShortTitle } from '../domain/display-title';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { SHORT_TITLE_SYSTEM_PROMPT } from '../domain/prompt/short-title.prompt';
import { ScheduleStatus } from '../domain/schedule.type';

interface GenerateShortTitlesInput {
  ownerId: string;
}

@Injectable()
export class GenerateShortTitlesUsecase {
  private readonly logger = new Logger(GenerateShortTitlesUsecase.name);

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({ ownerId }: GenerateShortTitlesInput): Promise<void> {
    try {
      const items = (await this.repository.findUndated(ownerId))
        .filter(
          (item) =>
            item.dueDate === null &&
            (item.status === ScheduleStatus.OPEN ||
              item.status === ScheduleStatus.IN_PROGRESS) &&
            (!item.shortTitle || item.shortTitleBasis !== item.title),
        )
        .slice(0, SHORT_TITLE_BATCH_MAX);
      if (items.length === 0) {
        return;
      }
      const titles = items
        .map(
          (item, index) =>
            `${index + 1}. ${item.title.replace(/[\r\n]+/g, ' ')}`,
        )
        .join('\n');
      const outcome = await this.agentRunService.execute<string>({
        agentType: AgentType.SCHEDULE,
        triggerType: TriggerType.AUTOPILOT_SCHEDULE_COLLECT_CRON,
        inputSnapshot: { action: 'GENERATE_SHORT_TITLES', count: items.length },
        run: async () => {
          const completion = await this.modelRouter.route({
            agentType: AgentType.SCHEDULE,
            request: {
              prompt: wrapUntrustedInput(titles),
              systemPrompt: SHORT_TITLE_SYSTEM_PROMPT,
            },
            noContractPreamble: true,
          });
          return {
            result: completion.text,
            modelUsed: completion.modelUsed,
            output: completion.text,
          };
        },
      });
      const seen = new Set<number>();
      for (const line of outcome.result.split(/\r?\n/)) {
        const match = /^(\d+)\.\s*(.+)$/.exec(line.trim());
        if (!match) {
          continue;
        }
        const index = Number(match[1]) - 1;
        const item = items[index];
        const shortTitle = match[2].trim();
        if (!item || seen.has(index) || !validateShortTitle(shortTitle)) {
          continue;
        }
        seen.add(index);
        await this.repository.updateShortTitle({
          id: item.id,
          shortTitle,
          basis: item.title,
        });
      }
    } catch (error) {
      this.logger.warn(
        `짧은 업무 이름 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
