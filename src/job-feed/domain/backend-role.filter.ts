// 랠릿은 직군 파라미터가 듣지 않고, 원티드는 백엔드 카테고리 ID 가 미확정이다.
// 그래서 소스 필터를 믿지 않고 모든 소스에 이 판별을 적용한다.
// 잘못된 카테고리로 디자이너 공고가 정상 응답으로 들어온 사례가 있다.
//
// 백엔드 제목 패턴은 성격이 다른 둘로 나눈다 — 뭉쳐 두면 직군 중립 패턴이
// 프론트 단서보다 먼저 걸려 "소프트웨어 엔지니어(Frontend)" 같은 공고가
// 프론트 제외에 도달하기 전에 통과해 버린다(Task 12 실증에서 실측).
//
// 백엔드를 명시한 제목 — 프론트 단서가 함께 있어도 백엔드 채용으로 본다(겸직 공고).
const EXPLICIT_BACKEND_PATTERNS: readonly RegExp[] = [
  /백[\s-]?엔드/u,
  /back[\s-]?end/iu,
  /서버\s*개발/u,
  /server\s*(engineer|developer)/iu,
];

// 직군이 중립인 제목 — 프론트 단서가 없을 때만 백엔드 후보로 본다.
const NEUTRAL_DEV_PATTERNS: readonly RegExp[] = [
  /소프트웨어\s*엔지니어/u,
  /software\s*engineer/iu,
  /플랫폼\s*(개발|엔지니어)/u,
  /platform\s*engineer/iu,
];

// 백엔드 키워드가 함께 있어도 무조건 제외한다 — 직군 자체가 다르거나 실제 공고가 아니다.
const HARD_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /인재풀/u,
  /디자이너/u,
  /designer/iu,
  /퍼블리셔/u,
  /안드로이드|android|\bios\b/iu,
];

// 프론트 단서 — 백엔드 키워드가 없을 때만 제외 근거가 된다.
const FRONTEND_HINT_PATTERNS: readonly RegExp[] = [
  /프[\s-]?론[\s-]?트/u,
  /front[\s-]?end/iu,
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
  'TypeORM',
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
  // ① 직군 자체가 다르거나 실제 공고가 아닌 것 — 백엔드 키워드가 있어도 제외한다.
  if (HARD_EXCLUDE_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }
  // ② 백엔드를 명시했으면 프론트를 겸해도 백엔드 채용이다.
  if (EXPLICIT_BACKEND_PATTERNS.some((pattern) => pattern.test(title))) {
    return true;
  }
  // ③ 프론트 단서가 있으면 프론트 공고다 — "소프트웨어 엔지니어(Frontend)" 가 여기서 걸린다.
  if (FRONTEND_HINT_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }
  // ④ 직군 중립 제목("소프트웨어 엔지니어")은 프론트 단서가 없을 때만 통과시킨다.
  if (NEUTRAL_DEV_PATTERNS.some((pattern) => pattern.test(title))) {
    return true;
  }
  // ⑤ 그 밖의 모호한 제목(예: "개발팀 팀장")은 스택으로 판정한다.
  // skillTags 는 rawSkillTags 를 사전으로 정규화한 결과라 부분집합이다 — 그대로
  // 합쳐서 세면 같은 기술이 두 번 잡혀, 서버 스킬 1개짜리 공고도 "2개 이상" 을
  // 통과해 버린다(회로설계·기구설계 등 하드웨어 공고가 "Python" 하나로 통과한
  // 실제 사례, Task 12 실증에서 발견). 중복 제거 후 서로 다른 서버 스킬만 센다.
  const serverSkillCount = [...new Set([...skillTags, ...rawSkillTags])].filter(
    (tag) => {
      return SERVER_SKILLS.has(tag);
    },
  ).length;
  return serverSkillCount >= MINIMUM_SERVER_SKILLS;
};
