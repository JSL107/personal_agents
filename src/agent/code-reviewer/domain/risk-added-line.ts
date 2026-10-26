// 주석 기호가 줄 처음이나 공백 뒤에 와야 한다 — `'// eslint-disable'` 같은 문자열 리터럴은 걸리지 않는다.
const SUPPRESSION =
  /(?:^|\s)(?:\/\/|\/\*|#|\*)\s*(eslint-disable(?:-next-line|-line)?|@ts-(?:ignore|expect-error|nocheck)|phpcs:(?:ignore|disable)|@phpstan-ignore[\w-]*|noqa|type:\s*ignore|nolint|istanbul ignore|c8 ignore)\b/;

interface TokenFormat {
  label: string;
  pattern: RegExp;
}

// 공급자 토큰 형식(Farol signals/security.ts 참고). 앞의 `(?<![A-Za-z0-9_-])` 는 식별자 중간의 일치
// (`disk-space-…` 안의 `sk-`)를 거른다. `g` 는 matchAll 로 한 줄의 모든 일치를 보기 위함이다.
const TOKEN_FORMATS: TokenFormat[] = [
  { label: 'AWS access key', pattern: /(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}/g },
  {
    label: 'GitHub 토큰',
    pattern: /(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{36,}/g,
  },
  {
    label: 'GitHub fine-grained 토큰',
    pattern: /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9_]{50,}/g,
  },
  {
    label: 'Slack 토큰',
    pattern: /(?<![A-Za-z0-9_-])xox[abposr]-[A-Za-z0-9-]{10,}/g,
  },
  {
    label: 'Stripe live 키',
    pattern: /(?<![A-Za-z0-9_-])sk_live_[A-Za-z0-9]{20,}/g,
  },
  {
    label: 'OpenAI·Anthropic 형식 키',
    pattern:
      /(?<![A-Za-z0-9_-])sk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{32,}/g,
  },
  {
    label: 'JWT',
    pattern:
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
];
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/;
// 문서 예시(`ghp_xxxx…`, AWS `…EXAMPLE`)를 거른다. 무작위 토큰은 문자당 엔트로피가 높다.
const MIN_TOKEN_ENTROPY = 3;
const EXAMPLE_TOKEN = /EXAMPLE/i;

const entropy = (text: string): number => {
  const counts = new Map<string, number>();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return [...counts.values()].reduce((bits, count) => {
    const share = count / text.length;
    return bits - share * Math.log2(share);
  }, 0);
};

const isRealToken = (candidate: string): boolean =>
  entropy(candidate) >= MIN_TOKEN_ENTROPY && !EXAMPLE_TOKEN.test(candidate);

export const findSuppression = (text: string): string | undefined =>
  SUPPRESSION.exec(text)?.[1];

// 같은 형식의 모든 일치를 본다 — 첫 일치만 보면 같은 줄의 예시 토큰 뒤에 온 진짜 토큰을 놓친다.
export const findLeakedToken = (text: string): string | undefined => {
  if (PRIVATE_KEY.test(text)) {
    return '개인 키';
  }
  const found = TOKEN_FORMATS.find(({ pattern }) =>
    [...text.matchAll(pattern)].some((match) => isRealToken(match[0])),
  );
  return found?.label;
};
