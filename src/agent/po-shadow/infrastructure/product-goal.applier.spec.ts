import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { PoShadowException } from '../domain/po-shadow.exception';
import { ProductGoalRepositoryPort } from '../domain/port/product-goal.repository.port';
import {
  MAX_ACTIVE_PRODUCT_GOALS,
  ProductGoalDraft,
  ProductGoalRecord,
} from '../domain/product-goal';
import { ProductGoalApplier } from './product-goal.applier';

const draft = (
  overrides: Partial<ProductGoalDraft> = {},
): ProductGoalDraft => ({
  title: '보존기간 파일 파기',
  successCriterion: '운영 배포 완료',
  keywords: ['보존기간'],
  dueDate: '2026-12-31',
  ...overrides,
});

const activeGoal = (id: number): ProductGoalRecord => ({
  id,
  slackUserId: 'U1',
  title: `목표 ${id}`,
  successCriterion: '배포 완료',
  keywords: [`k${id}`],
  dueDate: null,
  closedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
});

const previewOf = (payload: unknown): PreviewAction =>
  ({ id: 'p1', slackUserId: 'U1', payload }) as unknown as PreviewAction;

describe('ProductGoalApplier', () => {
  let repository: {
    findActive: jest.Mock;
    create: jest.Mock;
    createGuarded: jest.Mock;
    close: jest.Mock;
  };
  let applier: ProductGoalApplier;

  beforeEach(() => {
    repository = {
      findActive: jest.fn().mockResolvedValue([]),
      create: jest.fn(async (input) => ({ id: 7, ...input })),
      close: jest.fn().mockResolvedValue(true),
      // 실제 저장소처럼 활성 목록을 읽어 검사한 뒤에만 저장한다. 트랜잭션 원자성 자체는 DB 에서
      // 확인한다(PR 검증 노트) — 여기서는 applier 가 검사를 저장소 안으로 넘기는지를 본다.
      createGuarded: jest.fn(async (input, guard) => {
        const activeGoals = await repository.findActive(input.slackUserId);
        const problem = guard(activeGoals);
        if (problem !== null) {
          return { problem, activeGoals };
        }
        return { created: await repository.create(input) };
      }),
    };
    applier = new ProductGoalApplier(
      repository as unknown as ProductGoalRepositoryPort,
    );
  });

  it('승인된 선언을 저장한다', async () => {
    const result = await applier.apply(
      previewOf({ action: 'CREATE', draft: draft() }),
    );
    expect(repository.create).toHaveBeenCalledWith({
      slackUserId: 'U1',
      title: '보존기간 파일 파기',
      successCriterion: '운영 배포 완료',
      keywords: ['보존기간'],
      dueDate: new Date('2026-12-31T00:00:00Z'),
    });
    expect(result.message).toContain('목표를 저장했습니다');
  });

  // 정책 3 — 승인 시점에도 달성 기준을 다시 본다.
  it('끝을 판정할 수 없는 달성 기준은 승인돼도 저장하지 않는다', async () => {
    await expect(
      applier.apply(
        previewOf({
          action: 'CREATE',
          draft: draft({ successCriterion: '개선하기' }),
        }),
      ),
    ).rejects.toBeInstanceOf(PoShadowException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  // 정책 4 — 카드 두 장을 띄워 두고 차례로 누르면 생성 시점 검사는 둘 다 통과한다.
  it('승인 시점에 활성 목표가 상한이면 저장하지 않는다', async () => {
    repository.findActive.mockResolvedValue(
      Array.from({ length: MAX_ACTIVE_PRODUCT_GOALS }, (_, index) =>
        activeGoal(index + 1),
      ),
    );
    await expect(
      applier.apply(previewOf({ action: 'CREATE', draft: draft() })),
    ).rejects.toThrow(`활성 목표가 이미 ${MAX_ACTIVE_PRODUCT_GOALS}개`);
    expect(repository.create).not.toHaveBeenCalled();
  });

  // 같은 제목 카드 두 장을 차례로 승인하는 경우 — 선언 시점 검사는 둘 다 통과한다(#773 리뷰).
  it('승인 시점에 같은 제목의 활성 목표가 있으면 저장하지 않는다', async () => {
    repository.findActive.mockResolvedValue([
      { ...activeGoal(1), title: '보존기간 파일 파기' },
    ]);
    await expect(
      applier.apply(previewOf({ action: 'CREATE', draft: draft() })),
    ).rejects.toThrow('같은 제목의 활성 목표가 이미 있어');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('닫기를 승인하면 그 목표만 닫는다', async () => {
    const result = await applier.apply(
      previewOf({ action: 'CLOSE', goalId: 3, title: '업로드' }),
    );
    expect(repository.close).toHaveBeenCalledWith({
      id: 3,
      slackUserId: 'U1',
      closedAt: expect.any(Date),
    });
    expect(result.message).toContain('닫았습니다');
  });

  it('이미 닫힌 목표면 덮어쓰지 않았다고 알린다', async () => {
    repository.close.mockResolvedValue(false);
    const result = await applier.apply(
      previewOf({ action: 'CLOSE', goalId: 3, title: '업로드' }),
    );
    expect(result.message).toContain('이미 닫혀 있습니다');
  });

  it('형태가 다른 payload 는 거른다', async () => {
    await expect(
      applier.apply(previewOf({ action: 'CREATE' })),
    ).rejects.toBeInstanceOf(PoShadowException);
    expect(repository.create).not.toHaveBeenCalled();
  });
});
