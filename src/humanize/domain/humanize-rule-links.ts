// 윤문 문구·지표가 humanize-korean 정본의 어느 규칙에서 왔는지 적은 연결표.
//
// 문구를 정본에서 생성하지 않는 이유 — 이 레포의 문구는 정본을 실측으로 솎고 다시 쓴 것이라
// (`humanize-system.prompt.ts` 상단 주석) 생성하면 그 작업이 덮인다. 대신 연결만 남겨, 정본이
// 바뀌면 `pnpm humanize:check-links` 가 어느 문구를 다시 봐야 하는지 짚는다.
// 설계: docs/superpowers/specs/2026-10-23-humanize-research-worker-design.md §8
//
// 대응이 애매한 문구는 연결하지 않는다(`upstream: null` + 사유). 잘못된 연결은 엉뚱한 정본
// 변경에 경보를 울리고 진짜 변경은 놓치므로, 연결이 없는 것보다 나쁘다.
import { HumanizeRuleLink } from './humanize-rule-links.type';

const PROMPT_FILE = 'src/humanize/domain/humanize-system.prompt.ts';
const METRICS_FILE = 'src/humanize/domain/translationese-metrics.ts';

export const HUMANIZE_RULE_LINKS: readonly HumanizeRuleLink[] = [
  {
    id: 'prompt.translationese.double-passive',
    local: {
      file: PROMPT_FILE,
      text: '  - 이중 피동 "~되어진다/~보여진다" → 단일 피동("판단된다") 또는 능동',
    },
    upstream: { kind: 'quick-rule', ruleId: 'A-8' },
    note: '이중 피동을 능동 또는 단일 피동으로 고치는 처방.',
  },
  {
    id: 'prompt.translationese.by-agent',
    local: {
      file: PROMPT_FILE,
      text: '  - "~에 의해" 피동 → 행위자를 주어로("AI에 의해 생성된" → "AI가 만든")',
    },
    upstream: { kind: 'quick-rule', ruleId: 'A-9' },
    note: '행위자를 주어로 세우는 처방.',
  },
  {
    id: 'prompt.translationese.single-passive',
    local: {
      file: PROMPT_FILE,
      text: '  - 단일 피동 남발("검토된다", "예상된다", "~될 것으로 기대된다") → 능동으로. 행위자가 원문에 있으면 주어로 세우고, 없으면 주어를 생략한 능동으로 바꿔라("검토된다" → "검토한다"). 없는 행위자를 지어내지는 마라.',
    },
    upstream: null,
    note: 'A-8은 이중 피동, A-9는 에 의해 피동이다. 단일 피동 남발은 이대리 고유 처방.',
  },
  {
    id: 'prompt.translationese.light-verb',
    local: {
      file: PROMPT_FILE,
      text: '  - "가지고 있다" 류 직역 → 형용사·동사로 환원("강한 경쟁력을 가지고 있다" → "경쟁력이 강하다", "회의를 가지다" → "회의를 하다")',
    },
    upstream: { kind: 'quick-rule', ruleId: 'A-7' },
    note: '원문 예시의 강도와 시제를 보존하도록 예문을 다시 썼다.',
  },
  {
    id: 'prompt.translationese.inanimate-subject',
    local: {
      file: PROMPT_FILE,
      text: '  - 무생물 주어 + 만능 동사("본 작업은 ~를 보여준다") → 원문에 행위자가 있으면 그것을 주어로, 없으면 "~한 결과 ~다" 처럼 풀어라. 없는 행위자를 지어내지 마라.',
    },
    upstream: { kind: 'quick-rule', ruleId: 'A-15' },
    note: '추상 주어를 구체화하는 앞부분만 실었다. 인용 분리는 attributionPercentMax와 충돌한다.',
  },
  {
    id: 'prompt.habit.numbered-index',
    local: {
      file: PROMPT_FILE,
      text: '  - 숫자 괄호 인덱싱 "(1)·(2)·(3)" → 본문에 녹이거나 줄바꿈으로. 뒤에서 그 번호를 가리키는 문장이 있으면 **그 문장도 같이 바꿔라**("재시도는 (1)에만 허용한다" → "재시도는 1번만 허용한다").',
    },
    upstream: { kind: 'quick-rule', ruleId: 'C-9' },
    note: '뒤 문장의 번호 참조도 함께 고쳐 연결 관계를 보존한다.',
  },
  {
    id: 'prompt.habit.abstract-chain',
    local: {
      file: PROMPT_FILE,
      text: '  - "~적 N" 추상 체인("전략적 함의", "실천적 기반") → 명사끼리 붙이거나 풀어써라("전략 함의", "실천의 기반")',
    },
    upstream: { kind: 'quick-rule', ruleId: 'F-5' },
    note: '추상 명사 체인을 명사 결합이나 풀어쓰기로 고친다.',
  },
  {
    id: 'prompt.habit.comma-after-ending',
    local: {
      file: PROMPT_FILE,
      text: '  - 연결어미 뒤 쉼표("~하고,", "~지만,", "~어서,") → 쉼표를 빼라',
    },
    upstream: { kind: 'quick-rule', ruleId: 'C-11' },
    note: '정본의 6회 이상 신호 기준 없이 만나면 쉼표를 뺀다.',
  },
  {
    id: 'prompt.habit.hype',
    local: {
      file: PROMPT_FILE,
      text: '  - 과장 어휘("파격적", "압도적", "강력한", "획기적") → 원문에 있는 구체 사실·수치로 되돌려라(없는 수치를 지어내지 마라). **수식어가 그 문장의 주장이면 그대로 둬라** — "강력한 암호화가 필요하다"(요구 수준)·"압도적 지지를 받았다"(사실의 정도)·"강력한 보호책이 아니다"(부정의 대상)가 그렇다. 지우는 것은 평가성 군더더기뿐이다("압도적인 성과라고 볼 수 있다").',
    },
    upstream: { kind: 'quick-rule', ruleId: 'D-4' },
    note: '정본의 3회 이상 기준과 달리 평가성 군더더기만 지우고 주장인 수식어는 보존한다.',
  },
  {
    id: 'prompt.nominal-list',
    local: {
      file: PROMPT_FILE,
      text: '- 명사 나열형("~의 향상", "~의 제고", "~에 대한 검토") → 동사 중심 구어체 문어로.',
    },
    upstream: null,
    note: '후보 A-7, F-4, F-5는 일부 겹치지만 향상·제고·검토 나열의 동일 처방이 아니다.',
  },
  {
    id: 'prompt.parallelism',
    local: {
      file: PROMPT_FILE,
      text: '- 기계적 병렬·만연체·중복 수식어는 덜어내라. 생각과 이유가 자연스럽게 이어지면 한 문장으로 두고, 상황·근거·결론처럼 문장의 역할이 바뀌는 자리에서만 나눠라.',
    },
    upstream: null,
    note: '후보 E-1, E-3, J-5는 길이·문단 격자에 관한 규칙으로 문장 역할 기준과 다르다.',
  },
  {
    id: 'prompt.rhythm',
    local: {
      file: PROMPT_FILE,
      text: '- 어색한 리듬을 사람이 읽기 편한 흐름으로.',
    },
    upstream: null,
    note: 'quick-rules 전체 표에 동일한 포괄적 리듬 처방이 없다.',
  },
  {
    id: 'metrics.double-passive',
    local: {
      file: METRICS_FILE,
      text: 'const DOUBLE_PASSIVE_PATTERN =\n  /(?:되어|보여|쓰여|잊혀|닫혀|열려|불려|놓여)(?:지|진|져|졌|질|집)/g;',
    },
    upstream: { kind: 'python-symbol', symbol: '_DOUBLE_PASSIVE_TOKENS' },
    note: '표면형 중복 계수를 피하고 해요체 활용을 잡도록 어간과 활용형으로 다시 짰다.',
  },
  {
    id: 'metrics.by-agent',
    local: {
      file: METRICS_FILE,
      text: 'const BY_AGENT_PHRASE_PATTERN = /에\\s*의(?:해|하여)/g;',
    },
    upstream: { kind: 'python-symbol', symbol: '_BY_PASSIVE_RE' },
    note: '정본의 피동 서술어 조건은 실제 활용형을 놓쳐 에 의해 마커만 센다.',
  },
  {
    id: 'metrics.light-verb',
    local: {
      file: METRICS_FILE,
      text: 'const LITERAL_LIGHT_VERB_PATTERN =\n  /(?:가지고|갖고)\\s*있|[을를]\\s*(?:가지다|가지는|가진다|가졌|가져|가집)/g;',
    },
    upstream: { kind: 'python-symbol', symbol: '_HAVE_MAKE_LITERAL_TOKENS' },
    note: '자연스러운 만들다·결정을 내리다는 제외하고 관측값의 정밀도를 우선했다.',
  },
  {
    id: 'metrics.inanimate-subject',
    local: {
      file: METRICS_FILE,
      text: "const INANIMATE_SUBJECTS = [\n  '연구',\n  '데이터',\n  '분석',\n  '결과',\n  '시스템',\n  '기술',\n  '사례',\n  '현상',\n  '이론',\n  '정책',\n  '보고서',\n  'AI',\n  '인공지능',\n  '모델',\n  '알고리즘',\n  '변화',\n  '위기',\n  '혁신',\n  '사회',\n  '경제',\n] as const;",
    },
    upstream: { kind: 'python-symbol', symbol: 'inanimate_subject_rate' },
    note: '무생물 주어와 만능 서술어를 함께 보되 이대리 문장 분리 방식에 맞춰 다시 짰다.',
  },
];
