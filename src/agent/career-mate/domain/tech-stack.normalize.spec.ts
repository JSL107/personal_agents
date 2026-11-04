import { normalizeTechStack } from './tech-stack.normalize';

describe('normalizeTechStack', () => {
  it('실측 별칭과 버전을 정규화하고 성과별 빈도를 센다', () => {
    const result = normalizeTechStack([
      [
        'Python 3.11',
        'mysql2',
        'CloudSQL',
        'Lodash',
        'Express.js',
        'NodeJS',
        'Postgres',
      ],
      [
        'Python 3',
        'MySQL',
        'Cloud SQL',
        'lodash',
        'Express',
        'Node.js',
        'PostgreSQL',
      ],
      ['OAuth 2.0', 'GitHub Actions', 'github actions', 'PNG', 'REST API'],
    ]);

    expect(result.techStack).toEqual([
      'Python',
      'Express',
      'MySQL',
      'PostgreSQL',
      'Cloud SQL',
      'GitHub Actions',
      'Lodash',
      'Node.js',
      'OAuth',
    ]);
    expect(result.unknownTerms).toEqual([]);
  });

  it('금지어를 제거하고 알려지지 않은 표기는 OTHER와 검토 목록에 남긴다', () => {
    const result = normalizeTechStack([
      ['JSON', 'CSV', 'YAML', '단위 테스트', '응답 DTO', 'batch processing'],
      ['observability', 'REST API', '신규 엔진', 'TypeScript'],
    ]);

    expect(result.techStack).toEqual(['TypeScript', '신규 엔진']);
    expect(result.unknownTerms).toEqual(['신규 엔진']);
  });

  it('도구는 언어와 프레임워크보다 뒤에 두고 최대 12개로 자른다', () => {
    const result = normalizeTechStack([
      [
        'Jest',
        'TypeScript',
        'NestJS',
        'Vitest',
        'ESLint',
        'pnpm',
        'React',
        'Python',
        'Java',
        'Redis',
        'MySQL',
        'Docker',
        'Kubernetes',
        'OAuth',
      ],
    ]);

    expect(result.techStack.slice(0, 3)).toEqual([
      'Java',
      'Python',
      'TypeScript',
    ]);
    expect(result.techStack).toHaveLength(12);
    expect(result.techStack.indexOf('Jest')).toBeGreaterThan(2);
  });

  it('실데이터에서 한 카드에 함께 나온 표기를 접고 개념어를 뺀다', () => {
    expect(
      normalizeTechStack([
        ['Cloud Firestore', 'HTTP', 'SSR'],
        ['Firestore', 'Webhook', 'DateTime'],
      ]).techStack,
    ).toEqual(['Firestore']);
  });

  it('같은 성과 안의 같은 기술 표기는 빈도를 한 번만 센다', () => {
    const result = normalizeTechStack([
      ['Postgres', 'PostgreSQL', 'MySQL'],
      ['MySQL'],
    ]);

    expect(result.techStack).toEqual(['MySQL', 'PostgreSQL']);
  });
});
