// 초안 → 발행 전 식별정보 제거 단계 system prompt.
//
// 초안 출처에 따라 **계약이 다르다**. 하나로 두면 한쪽이 반드시 망가진다:
//
// - 회사 PR 회고(출처유형 `PR`): 사내 코드가 재료다. 클래스·함수·테이블 실명이 나가면 안 된다.
// - 오늘의 공부 딥다이브(출처유형 `오늘의 공부`): 공개 기술 문서와 **글쓴이 본인의 공개
//   저장소**가 재료다. 여기에 회사용 규칙을 적용하면 Slack·GitHub·NestJS 같은 공개 제품명과
//   자기 프로젝트 모듈명까지 "협업 메신저"·"○○ 계층" 으로 갈려 글이 통째로 일반론이 된다.
//   (2026-08-20 실측: 6,600자 발행본에서 협업 메신저 15회·코드 호스팅 플랫폼 9회·○○ 계층
//    19곳. 같은 초안의 윤문 전 원문에는 Slack·GitHub 이 그대로 살아 있었다.)
//
// 두 프롬프트를 공통 뼈대 + 차이로 조립하지 않고 각각 전문으로 적는다 — 제거/보존 목록이
// 이 파일의 본체이고, 조립으로 감추면 어느 출처에 무엇이 적용되는지 읽어서 알 수 없다.
//
// ⚠️ 한쪽을 고치면 다른 쪽도 함께 볼 것. 특히 출력 계약(JSON 형태·slug 규칙)은 파서가
//    공유하므로 한쪽만 어긋나면 그 출처의 발행만 조용히 깨진다.

const ANONYMIZE_ROLE_LINE =
  '당신은 개발 블로그 초안의 식별정보만 제거하는 익명화 편집자다.';
const ANONYMIZE_OUTPUT_LINES = [
  '출력은 설명·마크다운 코드펜스 밖 텍스트 금지, 아래 JSON 객체 하나만 허용한다:',
  '{"slug":"영문 kebab-case 3~6단어","description":"한 문장 요약","body":"익명화된 마크다운 본문"}',
];
const ANONYMIZE_FIDELITY_LINE =
  '사실 왜곡, 없던 내용 추가, 교훈 문단 삭제를 금지한다. 원문 대비 80% 미만으로 분량을 축소하지 않는다.';
const ANONYMIZE_SLUG_LINE =
  'slug은 영문 소문자 kebab-case 3~6단어로 만들고, description은 노션 요약이 비었을 때 쓸 한 문장으로 작성한다.';

// 회사 업무를 재료로 쓴 초안(저녁 회고 등). 기존 동작 그대로다.
export const BLOG_ANONYMIZE_SYSTEM_PROMPT = [
  ANONYMIZE_ROLE_LINE,
  ...ANONYMIZE_OUTPUT_LINES,
  '제거 대상: 회사명·서비스 브랜드명, 고객·기관·학교·개인 이름, 사내 시스템 코드네임, 내부 테이블·컬럼·파일·클래스·함수 실명, 사고 규모 실수치, 사내 URL·PR 번호·티켓 ID.',
  '사내 코드네임은 역할명으로 바꾼다. 예: v4/v5는 레거시(PHP)·신규(Node)처럼 역할과 기술 스택으로 표현한다.',
  '내부 식별자는 역할 설명으로 바꾼다. 예: 테이블·컬럼·파일·클래스·함수명은 해당 데이터 또는 책임의 일반 설명으로 대체한다.',
  '보존 대상: PHP, Node, MySQL 등의 기술 스택, 아키텍처 구조, 원장·스냅샷·멱등성 키·Source of Truth, 문제의 인과와 해결 판단, HTTP 상태코드, 일반 기술 용어, 글의 구조·분량·문체.',
  ANONYMIZE_FIDELITY_LINE,
  ANONYMIZE_SLUG_LINE,
].join('\n');

/**
 * 공개 기술 문서와 글쓴이 본인의 공개 저장소를 재료로 쓴 초안(오늘의 공부 딥다이브).
 *
 * 위 회사용 프롬프트에 완화 지시를 **덧붙이지 않고, 내부 식별자 치환 지시를 제거**했다.
 * 상반된 지시를 아래에 덧붙이기만 하면 모델이 위 지시를 그대로 지킨다(이 레포 실측 —
 * humanize-system.prompt.ts 의 보고체 라인 치환이 같은 이유로 replace 를 쓴다).
 *
 * 회사 관련 정보가 이 경로로 새더라도 파이프라인 끝의 금지어 검사(BLOG_MASK_FORBIDDEN_TERMS)가
 * 제목·요약·slug·경로·본문을 다시 훑어 막는다. 이 프롬프트는 1차 방어선을 출처에 맞게
 * 조정하는 것이지 방어선을 없애는 것이 아니다.
 */
export const BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT = [
  ANONYMIZE_ROLE_LINE,
  '이 초안은 공개 기술 문서 조사와 글쓴이 본인의 공개 저장소를 재료로 쓴 글이다. 기술 이름이 곧 글의 내용이므로 일반 명사로 바꾸지 마라.',
  ...ANONYMIZE_OUTPUT_LINES,
  '제거 대상: 글쓴이가 재직 중인 회사명과 그 회사의 서비스·제품 브랜드명, 고객·기관·학교·개인 이름, 사내 시스템 코드네임, 사내 저장소의 테이블·컬럼·클래스·함수 실명, 사고 규모 실수치, 사내 URL·PR 번호·티켓 ID.',
  '위에 해당하는 사내 식별자만 역할 설명으로 바꾼다. 그 밖의 이름은 손대지 마라.',
  '보존 대상: 공개된 제품·서비스·오픈소스 이름(예: Slack, GitHub, Notion, NestJS, Prisma, PostgreSQL, Redis), 기술 스택과 프로토콜 이름, 아키텍처 구조, 표준 용어와 HTTP 상태코드, 코드블록 안의 코드·명령어·설정, 글의 구조·분량·문체.',
  '본문의 `<!-- CODE_BLOCK_... -->` 은 코드 예시가 들어갈 자리다. 그 줄을 글자 하나 틀리지 않게 옮기고, 안쪽 ID 를 바꾸거나 그 자리에 코드를 상상해 채우지 마라 — 실제 코드는 이 단계가 끝난 뒤 원본 그대로 다시 들어간다.',
  '글쓴이 본인의 공개 프로젝트에 속한 모듈·클래스·함수·서비스 이름도 보존 대상이다. 이 이름들을 지우면 글에서 확인 가능한 근거가 함께 사라진다.',
  ANONYMIZE_FIDELITY_LINE,
  ANONYMIZE_SLUG_LINE,
].join('\n');

/**
 * 초안의 Notion `출처유형` 속성으로 익명화 계약을 고른다.
 *
 * 속성이 비어 있거나 모르는 값이면 **회사용(엄격)** 으로 떨어진다 — 새 출처가 생겼을 때
 * 조용히 느슨한 쪽을 타는 것보다, 지나치게 가리고 사람이 알아채는 편이 안전하다.
 */
export const selectAnonymizeSystemPrompt = (
  sourceType: string,
  publicProjectSourceType: string,
): string =>
  sourceType.trim() === publicProjectSourceType
    ? BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT
    : BLOG_ANONYMIZE_SYSTEM_PROMPT;
