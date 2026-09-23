// CLI provider 가 외부 모델(codex/claude/gemini) 로 stdin 을 보내기 직전 호출하는 PII redaction.
// 이대리는 GitHub issue body / Slack mention text / Notion page property 를 그대로 prompt 에 실어
// 외부 CLI 로 흘려보낸다 (AGENTS.md §6 라우팅). 그 입력에 우연히 포함된 시크릿(자격증명/토큰)이
// LLM provider 로 유출되는 surface 를 잘라낸다.
//
// 정책:
//  - 토큰 형태 (확실한 패턴) 만 redact — false positive 적은 prefix-기반 매칭 위주.
//  - 일반 이메일은 redact 하지 않는다 (협업 컨텍스트에서 정상적으로 등장, 정보 손실이 더 큼).
//  - redact 된 자리는 `[REDACTED:<type>]` 표식으로 남겨 prompt 의 의미는 유지하면서 secret 만 제거.
//
// ── 이름·전화번호·주민번호·계좌번호를 넣지 않는 이유 (2026-09-23 실측 판정) ───────────────
// 자동 리뷰가 SECURITY / MUST_FIX 로 반복 지적하는 항목이라 판정 근거를 여기 남긴다.
// 원장 전체(agent_run 의 자유 텍스트 + output + career_profile / job_posting / episodic_memory)
// 3,025만 자에 후보 정규식 10종을 프로덕션과 같은 JS 정규식 의미로 돌린 결과:
//
//  - 아래 PII_PATTERNS 8종의 실제 발화: 0건. 시크릿이 원장에 들어온 적이 없다 (기대 이득 기준선 0).
//  - 성씨+2자: 300,186건 매칭 / 정탐 0. 지우는 것은 "이전트"(에이전트)·"추가했"·"구현했"·
//    "백엔드"·"정합성" 같은 일반 어휘다. 한국어 성씨가 용언·명사의 첫 음절과 겹쳐 분리 불가.
//  - `님/씨` 앵커: 60건 / 정탐 0. 전부 회사명(까뮤이앤씨·엔에프씨·제이앤티씨) — 기업명이 C 를
//    "씨" 로 음차하므로 이 레포에서는 구조적으로 종목명 탐지기가 된다.
//  - 직함 앵커: 423건 / 정탐 0. "성과의 대표"·"형제 대표" 처럼 일반명사 "대표" 를 잡는다.
//  - 계좌번호 \d{2,6}-\d{2,6}-\d{2,6}: 3,042건 / 정탐 0. 고유 99개가 전부 ISO 날짜
//    (2026-09-18). 워크로그는 날짜가 정보의 축이라 이 오탐은 문서를 죽인다.
//  - 휴대폰·주민번호·카드번호: 합 4,482건 / 정탐 0. 유선전화 형태(0X-XXX-XXXX)까지 넓히면
//    668,497건이다. 모의투자가 프롬프트에 싣는 부동소수점("return3m":42.61780104712043,
//    "ma60":189509.46666666667) 내부에서 걸린다. 소수점 `.` 이 비단어 문자라 \b 로도 못 막는다.
//  - 진짜 PII 는 0건이었다 (정상 형태의 휴대폰·주민번호 0건, 이메일 1건은 공개된 OSS
//    메인테이너 주소로 현행 "이메일 제외" 정책이 맞게 판단한 사례).
//
// 함정: JS 정규식에서 한글은 \w 가 아니라서 한글끼리는 단어 경계가 없다. 그래서 `\b[가-힣]{3}\b`
// 류는 ASCII 뒤에 붙은 한글("aiot서비스" 의 "서비스") 만 잡고 이름은 하나도 못 잡는다 — 리뷰에선
// 안전해 보이고 테스트는 통과하면서 프로덕션에서는 죽는다.
//
// 이 함수는 CLI 로 나가는 prompt / systemPrompt 전문에 걸린다(codex-cli.provider.ts,
// claude-cli.provider.ts). 즉 오탐이 뭉개는 것은 사용자 PII 가 아니라 모델 지시문과 시세
// 데이터이고, 예외 없이 조용히 출력 품질만 떨어뜨린다.
//
// 재검토 조건: 타인 개인정보(3자 연락처·이력서·지원자 정보)를 원장에 저장하기 시작하면 다시
// 재측정한다. 그때도 이 함수의 전역 확장이 아니라 해당 저장 지점 한정으로 거는 것이 맞다.
// 회귀 방어는 pii-redaction.util.spec.ts 의 「오탐 방어」 케이스 3개가 맡는다.

interface PiiPattern {
  readonly type: string;
  readonly regex: RegExp;
}

const PII_PATTERNS: readonly PiiPattern[] = [
  // Slack: xoxb-/xoxp-/xoxa-/xoxr-/xoxs- prefix + 영숫자/하이픈
  { type: 'slack_token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  // GitHub PAT: classic(ghp_) / fine-grained(github_pat_)
  { type: 'github_pat', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { type: 'github_pat', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  // AWS Access Key ID: AKIA + 16 uppercase alphanumeric
  { type: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  // Anthropic API key: sk-ant-... (Claude API key — 이대리는 CLI 만 쓰지만 입력에 우연히 들어올 수 있음)
  { type: 'anthropic_key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI API key: sk-... (legacy 또는 sk-proj-) — Anthropic 패턴 다음에 평가되도록 순서 주의.
  { type: 'openai_key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  // Google API key: AIza prefix + 35자 (총 39자) — 끝에 \b 를 두지 않아 trailing 구두점/추가 문자 영향 없이 매칭.
  { type: 'google_api_key', regex: /\bAIza[0-9A-Za-z_-]{35}/g },
  // JWT (header.payload.signature) — Slack/GitHub 토큰이 아닌 일반 OAuth bearer 도 커버.
  {
    type: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
];

// PII 패턴들을 순회하며 토큰 류 시크릿을 마스킹한다.
// 입력 text 의 의미적 컨텍스트는 보존하면서 (자리 표식 유지) 시크릿 본문만 제거.
export const redactPii = (text: string): string =>
  PII_PATTERNS.reduce(
    (current, { type, regex }) => current.replace(regex, `[REDACTED:${type}]`),
    text,
  );
