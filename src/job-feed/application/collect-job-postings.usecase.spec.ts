import { RawJobPosting } from '../domain/job-feed.type';
import {
  JobSourceListResult,
  JobSourcePort,
} from '../domain/port/job-source.port';
import { CollectJobPostingsUsecase } from './collect-job-postings.usecase';

const backendPosting = (
  override: Partial<RawJobPosting> = {},
): RawJobPosting => {
  return {
    source: 'jumpit',
    sourceId: '1',
    company: '토스',
    title: '백엔드 개발자',
    detailUrl: 'https://example.test/1',
    rawSkillTags: ['Java', 'Spring Boot'],
    minYears: 3,
    maxYears: 7,
    yearsSource: 'RANGE',
    rawJobLevel: null,
    isNewcomer: false,
    rawLocations: ['서울 강남구'],
    ...override,
  };
};

const stubSource = (
  source: JobSourcePort['source'],
  result: JobSourceListResult | Error,
): JobSourcePort => {
  return {
    source,
    fetchList: async (): Promise<JobSourceListResult> => {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
};

const stubRepository = () => {
  return {
    upsertMany: jest.fn(async () => ({
      created: 1,
      updated: 0,
      contentChanged: 0,
    })),
    findScoringTargets: jest.fn(),
    saveScore: jest.fn(),
    findNotifiable: jest.fn(),
    claimForNotification: jest.fn(),
    findDetailTargets: jest.fn(),
    saveDetail: jest.fn(),
    findGapCandidates: jest.fn(),
    saveGapAgentRunId: jest.fn(),
  };
};

describe('CollectJobPostingsUsecase', () => {
  it('원시 수신·검증 통과·직군 통과를 따로 센다', async () => {
    const repository = stubRepository();
    const usecase = new CollectJobPostingsUsecase(
      [
        stubSource('jumpit', {
          received: 3,
          postings: [
            backendPosting(),
            backendPosting({
              sourceId: '2',
              title: '프론트엔드 개발자',
              rawSkillTags: ['React'],
            }),
          ],
          totalPages: 1,
        }),
      ],
      repository as never,
    );

    const result = await usecase.execute({ maxPages: 1 });

    expect(result.outcomes[0]).toMatchObject({
      source: 'jumpit',
      status: 'SUCCESS',
      received: 3,
      validated: 2,
      accepted: 1,
    });
  });

  it('한 소스가 실패해도 나머지는 진행한다', async () => {
    const repository = stubRepository();
    const usecase = new CollectJobPostingsUsecase(
      [
        stubSource('jumpit', new Error('HTTP 503')),
        stubSource('rallit', {
          received: 1,
          postings: [backendPosting({ source: 'rallit' })],
          totalPages: 1,
        }),
      ],
      repository as never,
    );

    const result = await usecase.execute({ maxPages: 1 });

    expect(result.outcomes[0].status).toBe('FAILED');
    expect(result.outcomes[0].error).toContain('HTTP 503');
    expect(result.outcomes[1].status).toBe('SUCCESS');
    expect(repository.upsertMany).toHaveBeenCalled();
  });

  it('수신은 있는데 검증이 0이면 실패로 본다 — 응답 형태 변경 신호다', async () => {
    const repository = stubRepository();
    const usecase = new CollectJobPostingsUsecase(
      [stubSource('jumpit', { received: 20, postings: [], totalPages: 1 })],
      repository as never,
    );

    const result = await usecase.execute({ maxPages: 1 });

    expect(result.outcomes[0].status).toBe('FAILED');
    expect(result.outcomes[0].error).toContain('검증');
  });

  it('공고가 실제로 0건인 정상 응답은 실패가 아니다', async () => {
    const repository = stubRepository();
    const usecase = new CollectJobPostingsUsecase(
      [stubSource('jumpit', { received: 0, postings: [], totalPages: 1 })],
      repository as never,
    );

    expect((await usecase.execute({ maxPages: 1 })).outcomes[0].status).toBe(
      'SUCCESS',
    );
  });

  it('사전에 없는 스킬 태그를 건수와 함께 모은다', async () => {
    const repository = stubRepository();
    const usecase = new CollectJobPostingsUsecase(
      [
        stubSource('jumpit', {
          received: 2,
          postings: [
            backendPosting({ rawSkillTags: ['Java', 'Quarkus'] }),
            backendPosting({
              sourceId: '2',
              rawSkillTags: ['Java', 'Quarkus'],
            }),
          ],
          totalPages: 1,
        }),
      ],
      repository as never,
    );

    const result = await usecase.execute({ maxPages: 1 });

    expect(result.unmatchedSkillTags).toEqual([{ tag: 'Quarkus', count: 2 }]);
  });

  it('dryRun 이면 저장하지 않는다', async () => {
    const repository = stubRepository();
    const usecase = new CollectJobPostingsUsecase(
      [
        stubSource('jumpit', {
          received: 1,
          postings: [backendPosting()],
          totalPages: 1,
        }),
      ],
      repository as never,
    );

    await usecase.execute({ maxPages: 1, dryRun: true });

    expect(repository.upsertMany).not.toHaveBeenCalled();
  });
});
