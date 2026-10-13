import { buildFindingReferences } from './finding-reference';
import { PlanRealityFact } from './plan-reality.diff';

const finding = (factIds: string[]) => ({
  factIds,
  point: '지적',
  suggestion: '제안',
});

describe('buildFindingReferences', () => {
  const facts: PlanRealityFact[] = [
    {
      id: 'unplanned:schoolbell-e/sbe-conduct-api#3922',
      kind: 'UNPLANNED_ASSIGNED',
      label: '학교 관리자용 항목 추가',
      detail: '계획에 없는 담당 항목',
      url: 'https://github.com/schoolbell-e/sbe-conduct-api/pull/3922',
    },
    {
      id: 'finding-unmoved:schoolbell-e/sbe-api-v5-puppeteer#153',
      kind: 'FINDING_UNMOVED',
      label: 'sbe-api-v5-puppeteer#153',
      detail: '28일째 미이동',
      url: 'https://github.com/schoolbell-e/sbe-api-v5-puppeteer/pull/153',
    },
    {
      id: 'failed:CODE_REVIEWER:2026-10-13T00:00:00.000Z',
      kind: 'FAILED_RUN',
      label: 'CODE_REVIEWER 워커',
      detail: '실패',
    },
  ] as PlanRealityFact[];

  it('GitHub 사실은 저장소#번호 + 원래 제목 + 링크로 만든다', () => {
    const [references] = buildFindingReferences(
      [finding(['unplanned:schoolbell-e/sbe-conduct-api#3922'])],
      facts,
      new Map(),
    );
    expect(references).toEqual([
      {
        text: 'sbe-conduct-api#3922 학교 관리자용 항목 추가',
        url: 'https://github.com/schoolbell-e/sbe-conduct-api/pull/3922',
      },
    ]);
  });

  it('제목 없는 지난 지적 사실은 이번 회차 조회 결과에서 제목을 찾고, 없으면 번호만 쓴다', () => {
    const key = 'schoolbell-e/sbe-api-v5-puppeteer#153';
    const [found] = buildFindingReferences(
      [finding([`finding-unmoved:${key}`])],
      facts,
      new Map([[key, '정합성 검증']]),
    );
    expect(found[0].text).toBe('sbe-api-v5-puppeteer#153 정합성 검증');

    const [missing] = buildFindingReferences(
      [finding([`finding-unmoved:${key}`])],
      facts,
      new Map(),
    );
    expect(missing[0].text).toBe('sbe-api-v5-puppeteer#153');
  });

  it('조회된 원래 제목이 있으면 잘린 label 보다 먼저 쓴다', () => {
    const key = 'schoolbell-e/sbe-conduct-api#3922';
    const [references] = buildFindingReferences(
      [finding([`unplanned:${key}`])],
      [{ ...facts[0], label: '학교 관리자용 항목 추…' }],
      new Map([[key, '학교 관리자용 항목 추가와 권한 정리']]),
    );
    expect(references[0].text).toBe(
      'sbe-conduct-api#3922 학교 관리자용 항목 추가와 권한 정리',
    );
  });

  it('같은 항목을 가리키는 사실은 표시 문구가 달라도 한 줄로 합친다', () => {
    const [references] = buildFindingReferences(
      [
        finding([
          'stalled:schoolbell-e/sbe-api-v5-puppeteer#153',
          'finding-unmoved:schoolbell-e/sbe-api-v5-puppeteer#153',
        ]),
      ],
      [
        ...facts,
        {
          id: 'stalled:schoolbell-e/sbe-api-v5-puppeteer#153',
          kind: 'PLANNED_STALLED',
          label: '정합성 검증',
          detail: '리뷰 0건',
          url: 'https://github.com/schoolbell-e/sbe-api-v5-puppeteer/pull/153',
        } as PlanRealityFact,
      ],
      new Map(),
    );
    expect(references).toEqual([
      {
        text: 'sbe-api-v5-puppeteer#153 정합성 검증',
        url: 'https://github.com/schoolbell-e/sbe-api-v5-puppeteer/pull/153',
      },
    ]);
  });

  it('GitHub 이 아닌 사실은 label 그대로, 없는 id 는 건너뛴다', () => {
    const [references] = buildFindingReferences(
      [finding(['failed:CODE_REVIEWER:2026-10-13T00:00:00.000Z', 'nope'])],
      facts,
      new Map(),
    );
    expect(references).toEqual([{ text: 'CODE_REVIEWER 워커', url: null }]);
  });
});
