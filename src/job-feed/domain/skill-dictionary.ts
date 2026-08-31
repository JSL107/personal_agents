// 별칭 → 정규명. 키는 비교용으로 소문자·공백·점·하이픈을 제거한 형태다.
// 공고와 프로필 양쪽에 같은 사전을 적용한다 — 한쪽만 다듬으면 절반만 작동한다.
//
// 이 사전은 "무엇이 기술인가" 를 정하는 화이트리스트가 아니라, 표기가 다른 같은 기술을
// 잇는 별칭표다. 여기 없는 태그도 버려지지 않는다(normalizeSkillTags 주석 참조).
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
  // 실측 미매칭 상위(2026-08) 보강 — 사전에 없으면 그 기술이 채점 분모에서 빠져
  // 점수가 부풀려진다(파일 상단 주석). 백엔드 공고에 실제로 나오는 것만 넣는다.
  ['sql', 'SQL'],
  ['oracle', 'Oracle'],
  ['mssql', 'MSSQL'],
  ['nosql', 'NoSQL'],
  ['php', 'PHP'],
  ['jsp', 'JSP'],
  // 'gcp' 는 이미 별칭으로 있다 — 풀네임 표기만 추가로 그 정규명에 묶는다.
  ['googlecloudplatform', 'GCP'],
  // PyTorch·LLM 은 프론트/모바일과 달리 백엔드 채용 공고(이미 직군 필터를 통과한
  // 표본)에 실제로 등장한 요구 기술이다 — AI/LLM 백엔드 포지션의 정당한 요구사항으로
  // 보고 추가한다(Next.js·Flutter·React Native 처럼 직군 자체가 다른 기술이 아니다).
  ['pytorch', 'PyTorch'],
  ['llm', 'LLM'],
  // 실측 미매칭 상위(2026-08-31) 2차 보강 — 표기만 다른 같은 기술이 서로 못 만나
  // 매칭 기회를 잃던 것들이다. 건수는 그날 수집한 247건 기준.
  //
  // 'Spring Framework' / 'spring-framework' (19건): 하이픈은 키에서 지워지므로 한 항목이
  // 두 표기를 모두 받는다. 'spring' 별칭은 있었지만 풀네임 표기가 없어 19건이 통째로 샜다.
  ['springframework', 'Spring Boot'],
  ['springjpa', 'JPA'],
  // 'Github' / 'GitHub' (20건): 형상관리 플랫폼 표기다. 프로필에는 GitHub Actions·API·Pages 가
  // 있지만 'GitHub' 단독이 없어 못 만났다 — 채용 태그 맥락에서 이 태그는 "형상관리로 GitHub 를
  // 쓴다" 는 뜻이므로 Git 보유로 충족된다고 보고 같은 정규명에 묶는다.
  ['github', 'Git'],
  // AWS 세부 서비스(aws-rds·Lambda·CloudFront 등)는 일부러 'AWS' 로 묶지 않는다.
  // 묶으면 서로 다른 서비스 요구 네 가지가 정규명 하나로 접혀 분모가 줄고, 'AWS' 만
  // 아는 프로필이 1/1 로 충족돼 이 커밋이 고치려는 부풀림이 그대로 재발한다(실측:
  // 다이노즈 공고가 요구 8개 → 5개로 접히며 50% 가 80% 로 뛰었다). 사전에 없으면
  // 원본 표기 그대로 분모에 남으므로, 안 넣는 것이 곧 정확한 채점이다.
  // REST 표기 흔들림(8건) — 이쪽은 같은 것을 달리 적은 것이라 묶는다.
  ['restful', 'REST API'],
  ['restfulapi', 'REST API'],
  ['api', 'REST API'],
  ['webapi', 'REST API'],
  ['expressjs', 'Express'],
  ['ubuntu', 'Linux'],
  // 프로필에 있는데 사전에 없어 양쪽 다 버려지던 것들 — 사전이 화이트리스트로 동작하던
  // 시절의 잔재다(아래 normalizeSkillTags 주석 참조).
  ['firebase', 'Firebase'],
  ['firestore', 'Firebase'],
  ['oauth20', 'OAuth'],
]);

// 기술이 아니라 직무·범주·협업도구를 가리키는 태그. 채점 분모에서 뺀다.
//
// 분모에 넣으면 요구사항을 성실히 적은 공고가 구조적으로 불리해진다 — 실측에서
// 'backend·데이터분석·프로젝트 관리·programming-languages' 를 함께 적은 공고 하나가
// Java·Spring Boot·REST API 를 모두 맞히고도 3/10 으로 떨어졌다.
//
// 이 목록은 사전과 달리 늘어나지 않는다. 신기술은 계속 나오지만 직무명과 협업도구는
// 한정적이라, 사전처럼 낡아서 결과를 틀리게 만들지 않는다.
const NON_SKILL_KEYS: ReadonlySet<string> = new Set([
  // 직군·범주어
  'backend',
  'frontend',
  'sw',
  'devops',
  'db',
  'dbms/rdbms',
  'ci/cd',
  'ci',
  'ux',
  'ui',
  '아키텍처',
  '프로젝트관리',
  '데이터분석',
  '이메일마케팅',
  '웹크롤링',
  'programminglanguages',
  'interfaces',
  'ai/인공지능',
  '인공지능(ai)',
  // 협업·문서·디자인 도구 — 보유 여부가 백엔드 적합도를 가르지 않는다.
  'jira',
  'confluence',
  'slack',
  'notion',
  'markdown',
  'figma',
  'adobexd',
  // 프로필 쪽에 섞여 있는 서술어 — 공고 태그와 우연히 만나 점수를 올리는 것을 막는다.
  'reliability',
  'errorhandling',
  'validation',
  'routing',
  'security',
  'logging',
  'dashboard',
  'modal',
  'feedback',
  'pii',
]);

export const toSkillKey = (raw: string): string => {
  return raw.toLowerCase().replace(/[\s._-]/gu, '');
};

export interface SkillNormalizeResult {
  // 이 공고(또는 프로필)가 실제로 요구·보유하는 기술 전부. 사전에 있으면 정규명,
  // 없으면 원본 표기를 그대로 담는다.
  identified: string[];
  unmatched: string[];
  // NON_SKILL_KEYS 로 뺀 것. 채점 경로는 무시하지만, 사용자가 직접 적은 값을 다루는
  // 쪽(JOB_FEED_AVOID_SKILLS)은 이걸 보고 "설정했는데 안 걸린다" 를 알려야 한다 —
  // 조용히 넘기면 이 레포가 반복해 겪은 "조용한 0건" 계열 사고가 된다.
  dropped: string[];
}

// 사전에 없는 원본은 버리지 않는다 — 사전 갱신 재료이자, 사전이 낡았다는 유일한 신호다.
//
// 🔴 사전에 없는 태그를 결과에서 빼면 그 태그가 채점 분모에서 사라져 점수가 부풀려진다.
// 2026-08-31 실측(247건): 공고가 요구한 열 가지 중 사전이 아는 둘만 남아 2/2 = 만점이
// 되는 식으로 179건이 부풀려졌고, 기준점 80을 넘긴 공고가 97건(39%)이라 필터가 사실상
// 작동하지 않았다. React·CSS·HTML·Figma 만 적힌 공고가 JavaScript 하나로 만점을 받았다.
// 같은 이유로 반대 방향 손실도 있었다 — Firebase 처럼 공고와 프로필 양쪽에 있는 기술도
// 사전에 없으면 둘 다 버려져 만나지 못했다.
//
// 그래서 사전에 없는 태그는 원본 표기 그대로 결과에 담는다. 비교는 toSkillKey 로 하므로
// (match-score.ts) 'React' 와 'react' 는 같은 것으로 만나고, 표시용으로는 원본 표기가
// 남는다. NON_SKILL_KEYS 에 해당하는 것만 뺀다.
export const normalizeSkillTags = (raw: string[]): SkillNormalizeResult => {
  const identified: string[] = [];
  const unmatched: string[] = [];
  const dropped: string[] = [];
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
    const key = toSkillKey(trimmed);
    if (NON_SKILL_KEYS.has(key)) {
      dropped.push(trimmed);
      continue;
    }
    const canonical = CANONICAL_BY_ALIAS.get(key);
    if (canonical === undefined) {
      // 사전에 없더라도 요구 기술이다 — 원본 표기로 담아 분모에 세고, 동시에 사전 보강
      // 재료로도 남긴다. 표기만 다른 중복('React' 와 'react')은 키로 걸러 한 번만 센다.
      if (!seenUnmatched.has(key)) {
        seenUnmatched.add(key);
        identified.push(trimmed);
        unmatched.push(trimmed);
      }
      continue;
    }
    if (seenCanonical.has(canonical)) {
      continue;
    }
    seenCanonical.add(canonical);
    identified.push(canonical);
  }

  return { identified, unmatched, dropped };
};
