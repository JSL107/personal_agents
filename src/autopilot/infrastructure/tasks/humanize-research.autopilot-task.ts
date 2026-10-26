import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RunHumanizeResearchUsecase } from '../../../agent/humanize-research/application/run-humanize-research.usecase';
import { formatHumanizeResearch } from '../../../slack/format/humanize-research.formatter';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class HumanizeResearchAutopilotTask implements AutopilotTask {
  readonly id = 'humanize-research';
  private readonly logger = new Logger(HumanizeResearchAutopilotTask.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly research: RunHumanizeResearchUsecase,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    const enabled =
      this.configService.get<string>('HUMANIZE_RESEARCH_ENABLED') === 'true';
    if (!enabled) {
      this.logger.log('skip — 게이트 OFF (HUMANIZE_RESEARCH_ENABLED !== true)');
      return { skip: true };
    }
    const result = await this.research.execute();
    return { skip: false, summaryText: formatHumanizeResearch(result.output) };
  }
}
