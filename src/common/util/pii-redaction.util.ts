// CLI provider 가 외부 모델(codex/claude/gemini) 로 stdin 을 보내기 직전 호출하는 PII redaction.
// 이대리는 GitHub issue body / Slack mention text / Notion page property 를 그대로 prompt 에 실어
// 외부 CLI 로 흘려보낸다 (AGENTS.md §6 라우팅). 그 입력에 우연히 포함된 시크릿(자격증명/토큰)이
// LLM provider 로 유출되는 surface 를 잘라낸다.
//
// 정책:
//  - 토큰 형태 (확실한 패턴) 만 redact — false positive 적은 prefix-기반 매칭 위주.
//  - 일반 이메일은 redact 하지 않는다 (협업 컨텍스트에서 정상적으로 등장, 정보 손실이 더 큼).
//  - redact 된 자리는 `[REDACTED:<type>]` 표식으로 남겨 prompt 의 의미는 유지하면서 secret 만 제거.

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
