import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/saramin-job-search.json'), 'utf8'),
);
import { mapSaraminList } from './saramin.mapper';

describe('mapSaraminList', () => {
  it('maps the documented job shape and KST deadline', () => {
    const result = mapSaraminList(fixture);
    expect(result).toEqual({
      received: 1,
      listings: [
        {
          source: 'saramin',
          sourceId: '27614114',
          detailUrl: fixture.jobs.job[0].url,
          company: '(주)사람인게임즈',
          title: '2D 캐릭터 원화가 모집',
          location: '서울 강남구',
          employmentType: '정규직',
          career: '경력3년↑',
          deadlineText: '~10/30',
        },
      ],
    });
  });

  it('counts rejected rows and accepts string fields and company.name', () => {
    const result = mapSaraminList({
      jobs: {
        job: [
          { active: 0 },
          {
            id: 12,
            url: 'https://example.com/12',
            company: { name: '회사' },
            position: {
              title: '원화',
              location: '서울 &gt; 강남구, 경기 &gt; 성남시',
              'job-type': '계약직',
              'experience-level': '신입',
            },
            'close-type': { code: '2', name: '채용시' },
          },
          {
            id: 13,
            url: 'https://example.com/13',
            position: { title: '제목' },
          },
        ],
      },
    });
    expect(result.received).toBe(3);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      company: '회사',
      location: '서울 강남구',
      employmentType: '계약직',
      career: '신입',
      deadlineText: '채용시',
    });
  });

  it('returns zero for malformed lists', () => {
    expect(mapSaraminList({ jobs: { job: {} } })).toEqual({
      received: 0,
      listings: [],
    });
  });
});
