import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAutopilotTaskTraceRepository } from './prisma-autopilot-task-trace.repository';

describe('PrismaAutopilotTaskTraceRepository', () => {
  it('입력을 그대로 저장한다', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const repository = new PrismaAutopilotTaskTraceRepository({
      autopilotTaskTrace: { create },
    } as unknown as PrismaService);

    await repository.record({
      taskId: 'knowledge-lint',
      firedAtKst: '2026-06-28',
      gateEnabled: true,
      candidateCount: 2,
      llmCalled: true,
      detail: 'L4 쿼터 소진으로 중단',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        taskId: 'knowledge-lint',
        firedAtKst: '2026-06-28',
        gateEnabled: true,
        candidateCount: 2,
        llmCalled: true,
        detail: 'L4 쿼터 소진으로 중단',
      },
    });
  });

  // best-effort — DB 가 죽었다고 해서 knowledge-lint/docs-sync-audit 의 원래 결과 반환까지
  // 실패하면 "관측만 추가한다"는 전제가 깨진다.
  it('저장이 실패해도 예외를 던지지 않는다', async () => {
    const create = jest.fn().mockRejectedValue(new Error('DB down'));
    const repository = new PrismaAutopilotTaskTraceRepository({
      autopilotTaskTrace: { create },
    } as unknown as PrismaService);

    await expect(
      repository.record({
        taskId: 'docs-sync-audit',
        firedAtKst: '2026-06-29',
        gateEnabled: false,
        candidateCount: null,
        llmCalled: false,
      }),
    ).resolves.toBeUndefined();
  });
});
