import { ArtJobPostingPrismaRepository } from './art-job-posting.prisma.repository';

describe('ArtJobPostingPrismaRepository.findKnownSourceIds', () => {
  // 2026-10-16: 첫 실행에서 보류만 한 공고(SEED)가 "본 것" 으로 잡혀 열린 공고 15건이 영영 안 나갔다.
  it('보류만 하고 안 보낸 공고(SEED, 미발송)는 이미 본 것에서 뺀다', async () => {
    const findMany = jest.fn().mockResolvedValue([{ sourceId: '1' }]);
    const repository = new ArtJobPostingPrismaRepository({
      artJobPosting: { findMany },
    } as never);

    const known = await repository.findKnownSourceIds(['1', '2']);

    expect(known).toEqual(new Set(['1']));
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      sourceId: { in: ['1', '2'] },
      NOT: { skippedReason: 'SEED', notifiedAt: null },
    });
  });
});
