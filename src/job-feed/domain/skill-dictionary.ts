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
  const seen = new Set<string>();

  for (const item of raw) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const canonical = CANONICAL_BY_ALIAS.get(toLookupKey(trimmed));
    if (canonical === undefined) {
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        unmatched.push(trimmed);
      }
      continue;
    }
    if (seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    matched.push(canonical);
  }

  return { matched, unmatched };
};
