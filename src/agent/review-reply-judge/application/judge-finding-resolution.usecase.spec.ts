import { AgentType } from '../../../model-router/domain/model-router.type';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import { FindingResolutionItem } from '../domain/finding-resolution.type';
import { JudgeFindingResolutionUsecase } from './judge-finding-resolution.usecase';

const items: FindingResolutionItem[] = [
  {
    id: 21,
    body: '트랜잭션 경계가 없다',
    filePath: 'src/order/order.service.ts',
    line: 42,
    changedDiff: '@@ -40,3 +40,5 @@\n+await this.prisma.$transaction(...)',
  },
  {
    id: 22,
    body: 'null 검증이 없다',
    filePath: 'src/order/order.repository.ts',
    line: 17,
    changedDiff: '@@ -15,2 +15,2 @@\n-const found = rows[0];',
  },
];

const router = (text: string): { route: jest.Mock } => ({
  route: jest
    .fn()
    .mockResolvedValue({ text, modelUsed: 'gpt', provider: 'CHATGPT' }),
});

const rejectingRouter = (error: unknown): { route: jest.Mock } => ({
  route: jest.fn().mockRejectedValue(error),
});

describe('JudgeFindingResolutionUsecase', () => {
  it('빈 배치는 모델을 호출하지 않는다', async () => {
    // 이 판정은 스윕(*/5)마다 도는 경로다. 빈 배치에도 CLI 를 태우면 쿼터만 태우고,
    // 이 레포는 codex 단일 provider 라 소진 시 fallback 이 없다.
    const modelRouter = router('[]');
    const usecase = new JudgeFindingResolutionUsecase(modelRouter as never);

    await expect(usecase.execute({ items: [] })).resolves.toEqual([]);

    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('해소 판정 배치를 모델 1회로 처리하고 verdict 를 파싱한다', async () => {
    const modelRouter = router(
      '판정:\n[{"id":21,"verdict":"FIXED","reason":"트랜잭션 추가됨"},{"id":22,"verdict":"NOT_FIXED","reason":"그대로"}]',
    );
    const usecase = new JudgeFindingResolutionUsecase(modelRouter as never);

    const judgments = await usecase.execute({ items });

    expect(modelRouter.route).toHaveBeenCalledTimes(1);
    expect(modelRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: AgentType.REVIEW_REPLY_JUDGE }),
    );
    expect(judgments).toEqual([
      { id: 21, verdict: 'FIXED', reason: '트랜잭션 추가됨' },
      { id: 22, verdict: 'NOT_FIXED', reason: '그대로' },
    ]);
  });

  it('JSON 파싱 실패 시 전건을 UNCLEAR 로 보수 처리한다', async () => {
    const usecase = new JudgeFindingResolutionUsecase(
      router('판정 불가합니다') as never,
    );

    await expect(usecase.execute({ items })).resolves.toEqual([
      { id: 21, verdict: 'UNCLEAR', reason: '' },
      { id: 22, verdict: 'UNCLEAR', reason: '' },
    ]);
  });

  it('누락 항목과 알 수 없는 verdict 만 UNCLEAR 로 처리한다', async () => {
    // FIXED 오판은 미해소 지적을 닫아버린다. 모르는 값은 결론이 아니라 미결로 남아야 한다.
    const usecase = new JudgeFindingResolutionUsecase(
      router(
        '[{"id":21,"verdict":"RESOLVED","reason":"됐음"},{"id":22,"verdict":"FIXED","reason":"검증 추가"}]',
      ) as never,
    );

    await expect(usecase.execute({ items })).resolves.toEqual([
      { id: 21, verdict: 'UNCLEAR', reason: '' },
      { id: 22, verdict: 'FIXED', reason: '검증 추가' },
    ]);
  });

  it('감싸진 CodexQuotaExceededException 은 원본 예외로 전파한다', async () => {
    // 호출부(harvest)가 이 원형을 보고 남은 PR 회차를 끊는다. 일반 실패로 뭉개면
    // 소진된 쿼터로 나머지 PR 을 계속 때린다.
    const quota = new CodexQuotaExceededException('Aug 1');
    const usecase = new JudgeFindingResolutionUsecase(
      rejectingRouter(
        Object.assign(new Error('model failed'), {
          cause: { primaryError: quota },
        }),
      ) as never,
    );

    await expect(usecase.execute({ items })).rejects.toBe(quota);
  });

  it('쿼터가 아닌 실패는 원본 에러 그대로 전파한다', async () => {
    const failure = new Error('codex CLI exit=1');
    const usecase = new JudgeFindingResolutionUsecase(
      rejectingRouter(failure) as never,
    );

    await expect(usecase.execute({ items })).rejects.toBe(failure);
  });
});
