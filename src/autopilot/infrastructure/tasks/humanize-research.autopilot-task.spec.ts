import { ConfigService } from '@nestjs/config';

import { RunHumanizeResearchUsecase } from '../../../agent/humanize-research/application/run-humanize-research.usecase';
import { HumanizeResearchAutopilotTask } from './humanize-research.autopilot-task';

describe('HumanizeResearchAutopilotTask', () => {
  it('ENABLED가 false면 수집·모델 경로를 호출하지 않는다', async () => {
    const config = { get: jest.fn().mockReturnValue('false') };
    const research = { execute: jest.fn() };
    const task = new HumanizeResearchAutopilotTask(
      config as unknown as ConfigService,
      research as unknown as RunHumanizeResearchUsecase,
    );
    expect(await task.run()).toEqual({ skip: true });
    expect(research.execute).not.toHaveBeenCalled();
  });
});
