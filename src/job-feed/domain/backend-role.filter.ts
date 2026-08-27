// 랠릿은 직군 파라미터가 듣지 않고, 원티드는 백엔드 카테고리 ID 가 미확정이다.
// 그래서 소스 필터를 믿지 않고 모든 소스에 이 판별을 적용한다.
// 잘못된 카테고리로 디자이너 공고가 정상 응답으로 들어온 사례가 있다.
const BACKEND_TITLE_PATTERNS: readonly RegExp[] = [
  /백[\s-]?엔드/u,
  /back[\s-]?end/iu,
  /서버\s*개발/u,
  /server\s*(engineer|developer)/iu,
  /소프트웨어\s*엔지니어/u,
  /software\s*engineer/iu,
  /플랫폼\s*(개발|엔지니어)/u,
  /platform\s*engineer/iu,
];

const EXCLUDE_TITLE_PATTERNS: readonly RegExp[] = [
  /프[\s-]?론[\s-]?트/u,
  /front[\s-]?end/iu,
  /인재풀/u,
  /디자이너/u,
  /designer/iu,
  /퍼블리셔/u,
  /안드로이드|android|ios\b/iu,
];

const SERVER_SKILLS: ReadonlySet<string> = new Set([
  'Java',
  'Kotlin',
  'Spring Boot',
  'Node.js',
  'NestJS',
  'Express',
  'Python',
  'Django',
  'FastAPI',
  'Go',
  'MSA',
  'REST API',
  'gRPC',
  'Kafka',
  'RabbitMQ',
  'BullMQ',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Elasticsearch',
  'Kubernetes',
  'Docker',
  'JPA',
  'MyBatis',
  'QueryDSL',
  'Prisma',
]);

const MINIMUM_SERVER_SKILLS = 2;

export interface BackendPostingInput {
  title: string;
  skillTags: string[];
  rawSkillTags: string[];
}

export const isBackendPosting = ({
  title,
  skillTags,
  rawSkillTags,
}: BackendPostingInput): boolean => {
  if (EXCLUDE_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }
  if (BACKEND_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return true;
  }
  // 제목이 모호한 공고(예: "개발팀 팀장")는 스택으로 판정한다.
  const serverSkillCount = [...skillTags, ...rawSkillTags].filter((tag) => {
    return SERVER_SKILLS.has(tag);
  }).length;
  return serverSkillCount >= MINIMUM_SERVER_SKILLS;
};
