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

  // 위 조건과 짝이다 — 보류분이 한 번 나가면 SEED 표시가 지워지고 발송 시각이 채워져 다시 "본 것" 이 된다.
  // 둘 중 하나만 깨져도 보류분이 영영 안 나가거나 매 회차 다시 나간다(#858 리뷰).
  it('보류분을 발송하면 SEED 를 지우고 발송 시각을 채운다', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const repository = new ArtJobPostingPrismaRepository({
      artJobPosting: { upsert },
    } as never);

    await repository.markNotified({
      listing: {
        sourceId: '285393',
        company: '시프트업',
        title: '[시프트업] 승리의 여신 니케 / 2D 캐릭터 원화가',
        detailUrl:
          'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=285393',
        deadlineText: '채용시',
        career: null,
        employmentType: null,
        location: null,
      },
      resolved: { gameTitle: null, image: null, googleSearchUrl: null },
      deadlineDate: null,
    });

    const { update } = upsert.mock.calls[0][0];
    expect(update.skippedReason).toBeNull();
    expect(update.notifiedAt).toBeInstanceOf(Date);
  });
});
