// 별칭 → 정규명. 키는 비교용으로 소문자·공백·점·하이픈을 제거한 형태다.
// 공고와 프로필 양쪽에 같은 사전을 적용한다 — 한쪽만 다듬으면 절반만 작동한다.
const CANONICAL_BY_ALIAS: ReadonlyMap<string, string> = new Map([
  ['java', 'Java'],
  ['kotlin', 'Kotlin'],
  ['spring', 'Spring Boot'],
  ['springboot', 'Spring Boot'],
  ['스프링부트', 'Spring Boot'],
  ['스프링', 'Spring Boot'],
  ['nodejs', 'Node.js'],
  ['node', 'Node.js'],
  ['nestjs', 'NestJS'],
  ['nest', 'NestJS'],
  ['express', 'Express'],
  ['typescript', 'TypeScript'],
  ['javascript', 'JavaScript'],
  ['python', 'Python'],
  ['django', 'Django'],
  ['fastapi', 'FastAPI'],
  ['go', 'Go'],
  ['golang', 'Go'],
  ['restapi', 'REST API'],
  ['rest', 'REST API'],
  ['graphql', 'GraphQL'],
  ['grpc', 'gRPC'],
  ['msa', 'MSA'],
  ['마이크로서비스', 'MSA'],
  ['microservices', 'MSA'],
  ['aws', 'AWS'],
  ['amazonec2', 'AWS'],
  ['gcp', 'GCP'],
  ['azure', 'Azure'],
  ['docker', 'Docker'],
  ['dockercompose', 'Docker'],
  ['kubernetes', 'Kubernetes'],
  ['k8s', 'Kubernetes'],
  ['postgresql', 'PostgreSQL'],
  ['postgres', 'PostgreSQL'],
  ['mysql', 'MySQL'],
  ['mariadb', 'MySQL'],
  ['mongodb', 'MongoDB'],
  ['redis', 'Redis'],
  ['elasticsearch', 'Elasticsearch'],
  ['kafka', 'Kafka'],
  ['rabbitmq', 'RabbitMQ'],
  ['bullmq', 'BullMQ'],
  ['queue', 'Message Queue'],
  // 정규명 자신('Message Queue')도 별칭으로 등록한다 — 없으면 이 값이 사전에 없는
  // 원본 태그로 취급돼, 입력 순서에 따라 매칭이 막히는 사고가 재발한다(같은 계열 예방).
  ['messagequeue', 'Message Queue'],
  ['prisma', 'Prisma'],
  ['typeorm', 'TypeORM'],
  ['jpa', 'JPA'],
  ['hibernate', 'JPA'],
  ['mybatis', 'MyBatis'],
  ['querydsl', 'QueryDSL'],
  ['jenkins', 'Jenkins'],
  ['githubactions', 'GitHub Actions'],
  ['terraform', 'Terraform'],
  ['nginx', 'Nginx'],
  ['linux', 'Linux'],
  ['git', 'Git'],
  ['jwt', 'JWT'],
  ['oauth', 'OAuth'],
  ['websocket', 'WebSocket'],
  ['datadog', 'Datadog'],
  ['grafana', 'Grafana'],
  ['prometheus', 'Prometheus'],
]);

const toLookupKey = (raw: string): string => {
  return raw.toLowerCase().replace(/[\s._-]/gu, '');
};

export interface SkillNormalizeResult {
  matched: string[];
  unmatched: string[];
}

// 사전에 없는 원본은 버리지 않는다 — 사전 갱신 재료이자, 사전이 낡았다는 유일한 신호다.
export const normalizeSkillTags = (raw: string[]): SkillNormalizeResult => {
  const matched: string[] = [];
  const unmatched: string[] = [];
  // 정규명과 미매칭 원본을 한 집합으로 관리하면, 'Message Queue'처럼 자기 이름이
  // 별칭 키에 없는 정규명이 먼저 오면 미매칭으로 먼저 등록돼 그 뒤 진짜 매칭('queue')을
  // 막는다 — 결과가 입력 순서에 따라 달라진다. 두 집합을 분리해 서로 간섭하지 않게 한다.
  const seenCanonical = new Set<string>();
  const seenUnmatched = new Set<string>();

  for (const item of raw) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const canonical = CANONICAL_BY_ALIAS.get(toLookupKey(trimmed));
    if (canonical === undefined) {
      if (!seenUnmatched.has(trimmed)) {
        seenUnmatched.add(trimmed);
        unmatched.push(trimmed);
      }
      continue;
    }
    if (seenCanonical.has(canonical)) {
      continue;
    }
    seenCanonical.add(canonical);
    matched.push(canonical);
  }

  return { matched, unmatched };
};
