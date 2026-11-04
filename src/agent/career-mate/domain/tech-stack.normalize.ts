export interface NormalizedTechStack {
  techStack: string[];
  unknownTerms: string[];
}

type TechCategory =
  | 'LANGUAGE'
  | 'FRAMEWORK'
  | 'DATASTORE'
  | 'CLOUD_INFRA'
  | 'OTHER'
  | 'TOOLING';

const CATEGORY_ORDER: TechCategory[] = [
  'LANGUAGE',
  'FRAMEWORK',
  'DATASTORE',
  'CLOUD_INFRA',
  'OTHER',
  'TOOLING',
];

const TECH_CATEGORIES: Record<TechCategory, string[]> = {
  LANGUAGE: [
    'TypeScript',
    'JavaScript',
    'Python',
    'Swift',
    'Java',
    'PHP',
    'Bash',
    'SQL',
    'CSS',
  ],
  FRAMEWORK: [
    'NestJS',
    'Express',
    'React',
    'Angular',
    'Next.js',
    'Astro',
    'SwiftUI',
    'SpriteKit',
    'Spring Boot',
    'Spring Data JPA',
    'Spring Security',
    'Tailwind CSS',
    'RxJS',
    'Electron',
    'Puppeteer',
    'Cheerio',
    'Zod',
    'class-validator',
    'Axios',
    'ts-pattern',
    'LangChain Deep Agents',
  ],
  DATASTORE: [
    'PostgreSQL',
    'MySQL',
    'Redis',
    'Prisma',
    'BullMQ',
    'Firestore',
    'Firebase Realtime Database',
    'pgvector',
    'Elasticsearch',
    'H2',
  ],
  CLOUD_INFRA: [
    'Docker',
    'Docker Compose',
    'Kubernetes',
    'GKE',
    'Cloud SQL',
    'Google Cloud Storage',
    'Google Cloud Pub/Sub',
    'Google Cloud Tasks',
    'Cloud Scheduler',
    'Cloud Logging',
    'Cloud Armor',
    'Firebase Functions',
    'Firebase Hosting',
    'Render',
    'Vercel',
    'GitHub Actions',
    'GCP Secret Manager',
  ],
  OTHER: [
    'Node.js',
    'Lodash',
    'OAuth',
    'OpenAPI',
    'Octokit',
    'Slack API',
    'Notion API',
    'GitHub API',
    'Codex CLI',
    'Claude CLI',
    'Slack Bolt',
    'JWT',
    'OIDC',
    'HMAC',
    'SSE',
    'AppKit',
    'MCP',
    'LLM',
    'GraphQL',
  ],
  TOOLING: [
    'Jest',
    'Vitest',
    'Supertest',
    'ESLint',
    'pnpm',
    'Nx',
    'Playwright',
    'JUnit',
    'Mockito',
    'AssertJ',
    'Sinon',
    'Prettier',
    'Git',
    'gcloud',
    'kubectl',
    'Gradle',
    'SwiftPM',
    'ts-node',
    'ts-jest',
    'Vite',
  ],
};

const TECH_STACK_MAX_COUNT = 12;

const keyOf = (value: string): string => {
  const lower = value.toLowerCase();
  const key = lower.replace(/[\s.-]/g, '');
  return key;
};

// 두 실측 참조의 표기 차이를 한 곳에서 접는다. 파일 형식과 작업 방식은 기술 스택이 아니다.
const ALIASES: Record<string, string> = {
  mysql2: 'MySQL',
  'mysql2/promise': 'MySQL',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  cloudsql: 'Cloud SQL',
  'express.js': 'Express',
  nodejs: 'Node.js',
  'node.js': 'Node.js',
  'github octokit': 'Octokit',
  'github actions': 'GitHub Actions',
  'oauth 2.0': 'OAuth',
  'swagger/openapi': 'OpenAPI',
  'openapi/swagger': 'OpenAPI',
  'google cloud storage': 'Google Cloud Storage',
  'cloud storage for firebase': 'Google Cloud Storage',
  'gcp cloud logging': 'Cloud Logging',
  'gcp cloud scheduler': 'Cloud Scheduler',
  'google cloud armor': 'Cloud Armor',
  'firebase cloud functions': 'Firebase Functions',
  'cloud functions for firebase v2': 'Firebase Functions',
  'swift package manager': 'SwiftPM',
  'spring data jpa': 'Spring Data JPA',
  'nestjs swagger': 'NestJS',
  'slack web api': 'Slack API',
  'notion rest api': 'Notion API',
  'google cloud pub/sub': 'Google Cloud Pub/Sub',
  'gke backendconfig': 'Kubernetes',
  // 2026-11-04 실데이터 dry-run 에서 같은 카드에 함께 나온 표기
  'cloud firestore': 'Firestore',
  'firebase auth': 'Firebase Authentication',
  'google cloud functions': 'Firebase Functions',
  'cloud functions for firebase': 'Firebase Functions',
  'google calendar api': 'Google Calendar',
  'claude code cli': 'Claude Code',
  'docker buildkit': 'Docker',
  buildkit: 'Docker',
  'hkdf-sha256': 'HKDF',
};

const BANNED_TERMS = new Set(
  [
    'PNG',
    'JSON',
    'JSONL',
    'CSV',
    'YAML',
    'TOML',
    'HTML',
    'SVG',
    'Markdown',
    'XLIFF',
    'ICS',
    '응답 DTO',
    '단위 테스트',
    'batch processing',
    'observability',
    'REST API',
    // 프로토콜·기법·개념어 — 카드 앞자리를 차지하면 "주력 스택" 으로 읽힌다(2026-11-04 dry-run 실측)
    'HTTP',
    'Webhook',
    'SSR',
    'TSX',
    'CLI',
    'CORS',
    'CSRF',
    'Cron',
    'DDD',
    'DateTime',
    'Environment Variables',
    'Data Validation',
    'Database Transactions',
    'Backtesting',
    'EUC-KR',
    'AGENTS.md',
  ].map(keyOf),
);

const CATALOG = new Map<string, { name: string; category: TechCategory }>();
for (const category of CATEGORY_ORDER) {
  for (const name of TECH_CATEGORIES[category]) {
    CATALOG.set(keyOf(name), { name, category });
  }
}
for (const [alias, name] of Object.entries(ALIASES)) {
  const canonical = CATALOG.get(keyOf(name));
  CATALOG.set(keyOf(alias), {
    name,
    category: canonical?.category ?? 'OTHER',
  });
}

export const normalizeTechStack = (
  tagLists: string[][],
): NormalizedTechStack => {
  const frequency = new Map<string, number>();
  const categoryByName = new Map<string, TechCategory>();
  const unknownTerms = new Set<string>();

  for (const tags of tagLists) {
    const inAccomplishment = new Set<string>();
    for (const tag of tags) {
      const trimmed = tag.trim().replace(/\s+v?\d+(\.\d+)*$/, '');
      const key = keyOf(trimmed);
      if (!key || BANNED_TERMS.has(key)) {
        continue;
      }
      const found = CATALOG.get(key);
      const name = found?.name ?? trimmed;
      if (!found) {
        unknownTerms.add(name);
      }
      categoryByName.set(name, found?.category ?? 'OTHER');
      inAccomplishment.add(name);
    }
    for (const name of inAccomplishment) {
      frequency.set(name, (frequency.get(name) ?? 0) + 1);
    }
  }

  const techStack = [...frequency.keys()]
    .sort((left, right) => {
      const leftCategory = CATEGORY_ORDER.indexOf(
        categoryByName.get(left) as TechCategory,
      );
      const rightCategory = CATEGORY_ORDER.indexOf(
        categoryByName.get(right) as TechCategory,
      );
      const categoryAndFrequencyOrder =
        leftCategory - rightCategory ||
        (frequency.get(right) ?? 0) - (frequency.get(left) ?? 0) ||
        left.localeCompare(right, 'en');
      return categoryAndFrequencyOrder;
    })
    .slice(0, TECH_STACK_MAX_COUNT);

  const sortedUnknownTerms = [...unknownTerms].sort((left, right) =>
    left.localeCompare(right, 'en'),
  );
  return {
    techStack,
    unknownTerms: sortedUnknownTerms,
  };
};
