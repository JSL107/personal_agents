import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { UNTRUSTED_INPUT_NOTICE } from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { SHORT_TITLE_BATCH_MAX } from '../domain/daily-todo.constant';
import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleStatus } from '../domain/schedule.type';
import { buildScheduleItemRecord } from '../domain/schedule-item.fixture';
import { GenerateShortTitlesUsecase } from './generate-short-titles.usecase';

const item = (id: number) =>
  buildScheduleItemRecord({
    id,
    title: `원래 제목 ${id}`,
    dueDate: null,
    status: ScheduleStatus.OPEN,
  });
const setup = (items = [item(1), item(2)]) => {
  const repository = {
    findUndated: jest.fn().mockResolvedValue(items),
    updateShortTitle: jest.fn().mockResolvedValue(true),
  };
  const route = jest.fn().mockResolvedValue({
    text: '1. 첫 업무\n2. 둘째 업무\n9. 범위 밖',
    modelUsed: 'codex',
  });
  const execute = jest
    .fn()
    .mockImplementation(async ({ run }: { run: () => Promise<unknown> }) => ({
      result: ((await run()) as { result: unknown }).result,
    }));
  const usecase = new GenerateShortTitlesUsecase(
    repository as unknown as ScheduleRepositoryPort,
    { route } as unknown as ModelRouterUsecase,
    { execute } as unknown as AgentRunService,
  );
  return { repository, route, execute, usecase };
};

describe('GenerateShortTitlesUsecase', () => {
  it('번호가 맞는 줄만 저장하고 안전한 자유 텍스트 배치를 호출한다', async () => {
    const { usecase, repository, route, execute } = setup();
    await usecase.execute({ ownerId: 'U1' });
    expect(repository.updateShortTitle).toHaveBeenCalledTimes(2);
    expect(repository.updateShortTitle).toHaveBeenNthCalledWith(1, {
      id: 1,
      shortTitle: '첫 업무',
      basis: '원래 제목 1',
    });
    expect(repository.updateShortTitle).toHaveBeenNthCalledWith(2, {
      id: 2,
      shortTitle: '둘째 업무',
      basis: '원래 제목 2',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.SCHEDULE,
        triggerType: TriggerType.AUTOPILOT_SCHEDULE_COLLECT_CRON,
      }),
    );
    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][0].request).toEqual(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(UNTRUSTED_INPUT_NOTICE),
        prompt: expect.stringContaining(
          '<untrusted-input>\n1. 원래 제목 1\n2. 원래 제목 2\n</untrusted-input>',
        ),
      }),
    );
    expect(route.mock.calls[0][0].request.outputSchema).toBeUndefined();
  });
  it('검사를 어긴 줄은 저장하지 않는다', async () => {
    const { usecase, repository, route } = setup([
      item(1),
      item(2),
      item(3),
      item(4),
    ]);
    route.mockResolvedValue({
      text: `1. ${'가'.repeat(31)}\n2. #123\n3. 줄표 — 포함\n4. 정상 업무`,
      modelUsed: 'codex',
    });
    await usecase.execute({ ownerId: 'U1' });
    expect(repository.updateShortTitle).toHaveBeenCalledTimes(1);
    expect(repository.updateShortTitle).toHaveBeenCalledWith({
      id: 4,
      shortTitle: '정상 업무',
      basis: '원래 제목 4',
    });
  });
  it('모델 실패 시 아무것도 저장하지 않고 예외를 삼킨다', async () => {
    const { usecase, repository, route } = setup();
    route.mockRejectedValue(new Error('quota'));
    await expect(usecase.execute({ ownerId: 'U1' })).resolves.toBeUndefined();
    expect(repository.updateShortTitle).not.toHaveBeenCalled();
  });
  it('CANDIDATE, 기한 있는 업무와 유효한 이름은 제외하고 최대 20건만 보낸다', async () => {
    const items = [
      buildScheduleItemRecord({
        ...item(100),
        status: ScheduleStatus.CANDIDATE,
      }),
      buildScheduleItemRecord({ ...item(101), dueDate: new Date() }),
      buildScheduleItemRecord({
        ...item(102),
        shortTitle: '기존',
        shortTitleBasis: '원래 제목 102',
      }),
      ...Array.from({ length: SHORT_TITLE_BATCH_MAX + 1 }, (_, i) =>
        item(i + 1),
      ),
    ];
    const { usecase, route } = setup(items);
    await usecase.execute({ ownerId: 'U1' });
    const prompt = route.mock.calls[0][0].request.prompt as string;
    expect(prompt).not.toContain('원래 제목 100');
    expect(prompt).not.toContain('원래 제목 101');
    expect(prompt).not.toContain('원래 제목 102');
    expect(prompt).not.toContain('원래 제목 21');
    expect(prompt).toContain('20. 원래 제목 20');
  });
  it('제목이 바뀐 경우 원래 제목을 basis로 조건부 저장한다', async () => {
    const { usecase, repository } = setup([item(1)]);
    repository.updateShortTitle.mockResolvedValue(false);
    await usecase.execute({ ownerId: 'U1' });
    expect(repository.updateShortTitle).toHaveBeenCalledWith({
      id: 1,
      shortTitle: '첫 업무',
      basis: '원래 제목 1',
    });
  });
  it('실패한 배치 뒤의 항목을 다음 회차에 처리한다', async () => {
    const { usecase, route } = setup(
      Array.from({ length: SHORT_TITLE_BATCH_MAX + 1 }, (_, index) =>
        item(index + 1),
      ),
    );
    route.mockRejectedValueOnce(new Error('quota'));
    await usecase.execute({ ownerId: 'U1' });
    await usecase.execute({ ownerId: 'U1' });
    expect(route.mock.calls[1][0].request.prompt).toContain('1. 원래 제목 21');
  });

  it('내부 용어가 포함된 생성 결과는 저장하지 않는다', async () => {
    const { usecase, route, repository } = setup([item(1)]);
    route.mockResolvedValue({ text: '1. CODE_REVIEWER', modelUsed: 'codex' });
    await usecase.execute({ ownerId: 'U1' });
    expect(repository.updateShortTitle).not.toHaveBeenCalled();
  });

  it('대상이 없으면 모델을 호출하지 않는다', async () => {
    const { usecase, route } = setup([]);
    await usecase.execute({ ownerId: 'U1' });
    expect(route).not.toHaveBeenCalled();
  });
});
