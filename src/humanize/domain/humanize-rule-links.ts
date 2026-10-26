// 윤문 문구·지표가 humanize-korean 정본의 어느 규칙에서 왔는지 적은 연결표.
//
// 문구를 정본에서 생성하지 않는 이유 — 이 레포의 문구는 정본을 실측으로 솎고 다시 쓴 것이라
// (`humanize-system.prompt.ts` 상단 주석) 생성하면 그 작업이 덮인다. 대신 연결만 남겨, 정본이
// 바뀌면 `pnpm humanize:check-links` 가 어느 문구를 다시 봐야 하는지 짚는다.
// 설계: docs/superpowers/specs/2026-10-23-humanize-research-worker-design.md §8
//
// 대응이 애매한 문구는 연결하지 않는다(`upstream: null` + 사유). 잘못된 연결은 엉뚱한 정본
// 변경에 경보를 울리고 진짜 변경은 놓치므로, 연결이 없는 것보다 나쁘다.
export type UpstreamSource =
  | { kind: 'quick-rule'; ruleId: string }
  | { kind: 'python-symbol'; symbol: string };

export type HumanizeRuleLink = {
  id: string;
  local: { file: string; text: string };
  upstream: UpstreamSource | null;
  upstreamSnapshot: string | null;
  note: string;
};

const PROMPT_FILE = 'src/humanize/domain/humanize-system.prompt.ts';
const METRICS_FILE = 'src/humanize/domain/translationese-metrics.ts';

export const HUMANIZE_RULE_LINKS: readonly HumanizeRuleLink[] = [
  {
    id: 'prompt.translationese.double-passive',
    local: { file: PROMPT_FILE, text: '  - 이중 피동 "~되어진다/~보여진다" →' },
    upstream: { kind: 'quick-rule', ruleId: 'A-8' },
    upstreamSnapshot:
      '| A-8 | 이중 피동 "~되어진다" | S1 | 능동 또는 단일 피동 ("판단되어진다" → "판단된다") |',
    note: '이중 피동을 능동 또는 단일 피동으로 고치는 처방.',
  },
  {
    id: 'prompt.translationese.by-agent',
    local: { file: PROMPT_FILE, text: '  - "~에 의해" 피동 →' },
    upstream: { kind: 'quick-rule', ruleId: 'A-9' },
    upstreamSnapshot:
      '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |',
    note: '행위자를 주어로 세우는 처방.',
  },
  {
    id: 'prompt.translationese.single-passive',
    local: { file: PROMPT_FILE, text: '  - 단일 피동 남발(' },
    upstream: null,
    upstreamSnapshot: null,
    note: 'A-8은 이중 피동, A-9는 에 의해 피동이다. 단일 피동 남발은 이대리 고유 처방.',
  },
  {
    id: 'prompt.translationese.light-verb',
    local: { file: PROMPT_FILE, text: '  - "가지고 있다" 류 직역 →' },
    upstream: { kind: 'quick-rule', ruleId: 'A-7' },
    upstreamSnapshot:
      '| A-7 | "가지고 있다" / have·make·take·give + N 직역 | S1 | 형용사·동사 환원 또는 이중주어("회의를 가지다" → "회의를 했다", "강한 경쟁력을 가지고 있다" → "경쟁력이 강하다") |',
    note: '원문 예시의 강도와 시제를 보존하도록 예문을 다시 썼다.',
  },
  {
    id: 'prompt.translationese.inanimate-subject',
    local: { file: PROMPT_FILE, text: '  - 무생물 주어 + 만능 동사(' },
    upstream: { kind: 'quick-rule', ruleId: 'A-15' },
    upstreamSnapshot:
      '| A-15 | 추상 주어 + 만능 동사 / 사역·인지 동사 | S2 | 구체 주어로 환원, 사역은 "X 때문에/덕분에/로 인해" 부사절, 인지 동사(suggest/show/indicate/reveal)는 "~에 따르면 ~이다"·"~으로 ~이 드러났다" 분리 |',
    note: '추상 주어를 구체화하는 앞부분만 실었다. 인용 분리는 attributionPercentMax와 충돌한다.',
  },
  {
    id: 'prompt.habit.numbered-index',
    local: { file: PROMPT_FILE, text: '  - 숫자 괄호 인덱싱 ' },
    upstream: { kind: 'quick-rule', ruleId: 'C-9' },
    upstreamSnapshot:
      '| C-9 | 숫자 괄호 인덱싱 "(1)·(2)·(3)" | S2 | 본문에 녹이거나 단순 줄바꿈 |',
    note: '뒤 문장의 번호 참조도 함께 고쳐 연결 관계를 보존한다.',
  },
  {
    id: 'prompt.habit.abstract-chain',
    local: { file: PROMPT_FILE, text: '  - "~적 N" 추상 체인(' },
    upstream: { kind: 'quick-rule', ruleId: 'F-5' },
    upstreamSnapshot:
      '| F-5 | "~적 N" 추상 체인 ("전략적 함의·실천적 기반") | S2 | 명사+명사 또는 풀어쓰기("전략 함의·실천의 기반") |',
    note: '추상 명사 체인을 명사 결합이나 풀어쓰기로 고친다.',
  },
  {
    id: 'prompt.habit.comma-after-ending',
    local: { file: PROMPT_FILE, text: '  - 연결어미 뒤 쉼표(' },
    upstream: { kind: 'quick-rule', ruleId: 'C-11' },
    upstreamSnapshot:
      '| C-11 | 연결어미 뒤 쉼표 (-고/-며/-지만/-며서/-아서/-어서 직후 쉼표) | S1 | 쉼표 제거. 6+회=강한 신호. KatFish 4.84배 분리도 |',
    note: '정본의 6회 이상 신호 기준 없이 만나면 쉼표를 뺀다.',
  },
  {
    id: 'prompt.habit.hype',
    local: { file: PROMPT_FILE, text: '  - 과장 어휘(' },
    upstream: { kind: 'quick-rule', ruleId: 'D-4' },
    upstreamSnapshot:
      '| D-4 | hype 어휘(파격적·압도적·강력한·획기적·치명적) 3회+ | S1 | 구체 수치·사실로 환원 |',
    note: '정본의 3회 이상 기준과 달리 평가성 군더더기만 지우고 주장인 수식어는 보존한다.',
  },
  {
    id: 'prompt.nominal-list',
    local: { file: PROMPT_FILE, text: '- 명사 나열형(' },
    upstream: null,
    upstreamSnapshot: null,
    note: '후보 A-7, F-4, F-5는 일부 겹치지만 향상·제고·검토 나열의 동일 처방이 아니다.',
  },
  {
    id: 'prompt.parallelism',
    local: {
      file: PROMPT_FILE,
      text: '- 기계적 병렬·만연체·중복 수식어는 덜어내라.',
    },
    upstream: null,
    upstreamSnapshot: null,
    note: '후보 E-1, E-3, J-5는 길이·문단 격자에 관한 규칙으로 문장 역할 기준과 다르다.',
  },
  {
    id: 'prompt.rhythm',
    local: {
      file: PROMPT_FILE,
      text: '- 어색한 리듬을 사람이 읽기 편한 흐름으로.',
    },
    upstream: null,
    upstreamSnapshot: null,
    note: 'quick-rules 전체 표에 동일한 포괄적 리듬 처방이 없다.',
  },
  {
    id: 'metrics.double-passive',
    local: { file: METRICS_FILE, text: 'const DOUBLE_PASSIVE_PATTERN =\n  /' },
    upstream: { kind: 'python-symbol', symbol: '_DOUBLE_PASSIVE_TOKENS' },
    upstreamSnapshot:
      '["되어진다", "되어졌다", "되어진", "되어지는", "여지다", "여진다", "여졌다", "여진", "잊혀진", "잊혀졌", "잊혀진다", "보여진다", "보여졌다", "보여진", "쓰여진다", "쓰여졌다", "쓰여진", "닫혀진", "열려진", "불려진", "놓여진"]',
    note: '표면형 중복 계수를 피하고 해요체 활용을 잡도록 어간과 활용형으로 다시 짰다.',
  },
  {
    id: 'metrics.by-agent',
    local: { file: METRICS_FILE, text: 'const BY_AGENT_PHRASE_PATTERN = /' },
    upstream: { kind: 'python-symbol', symbol: '_BY_PASSIVE_RE' },
    upstreamSnapshot:
      '에\\s*의(?:해|하여)\\s+\\S{0,12}?(?:되|받|당하|지)(?:다|었|어|ㄴ다|는다|는|ㄹ|을)',
    note: '정본의 피동 서술어 조건은 실제 활용형을 놓쳐 에 의해 마커만 센다.',
  },
  {
    id: 'metrics.light-verb',
    local: {
      file: METRICS_FILE,
      text: 'const LITERAL_LIGHT_VERB_PATTERN =\n  /',
    },
    upstream: { kind: 'python-symbol', symbol: '_HAVE_MAKE_LITERAL_TOKENS' },
    upstreamSnapshot:
      '["가지고 있다", "가지고있다", "가지고 있는", "가지고있는", "가지고 있었", "가지고있었", "가지고 있으", "가지고있으", "갖고 있다", "갖고있다", "갖고 있는", "갖고있는", "을 가지다", "를 가지다", "을 가졌", "를 가졌", "을 가진다", "를 가진다", "을 만들다", "를 만들다", "을 만들었", "를 만들었", "을 만들어 낸", "를 만들어 낸", "을 만들어낸", "를 만들어낸", "회의를 가지", "회의를 가졌", "한번 봄을 가지", "결정을 내리", "결정을 내렸"]',
    note: '자연스러운 만들다·결정을 내리다는 제외하고 관측값의 정밀도를 우선했다.',
  },
  {
    id: 'metrics.inanimate-subject',
    local: { file: METRICS_FILE, text: 'const INANIMATE_SUBJECTS = [' },
    upstream: { kind: 'python-symbol', symbol: 'inanimate_subject_rate' },
    upstreamSnapshot:
      'def inanimate_subject_rate(text: str) -> float:\n    """T1: inanimate-subject + universal-verb pattern rate.\n\n    Approximation: count sentences whose first content noun ends with one\n    of the v2.0 hanja suffixes (-성·-적·-화·-도·-력·-감·-원) OR matches a\n    short list of inanimate/abstract subjects (`연구·데이터·분석·결과·시스템·\n    기술·사례·현상·이론·정책·보고서`) AND whose verb is a universal\n    cognitive/declarative verb (보여준다·시사한다·만든다·드러낸다·제시한다·\n    나타낸다·증명한다·말해준다·의미한다·가져온다). Returns\n    matching_sents / total_sents in [0, 1].\n    """\n    sents = _split_sentences(text)\n    if not sents:\n        return 0.0\n    inanimate_subjects = (\n        "연구", "데이터", "분석", "결과", "시스템", "기술", "사례",\n        "현상", "이론", "정책", "보고서", "AI", "인공지능", "모델",\n        "알고리즘", "변화", "위기", "혁신", "사회", "경제",\n    )\n    universal_verbs = (\n        "보여준다", "보여줬다", "보여주는", "시사한다", "시사하는",\n        "만든다", "만들어", "드러낸다", "드러냈다", "드러내는",\n        "제시한다", "제시했다", "나타낸다", "나타냈다", "나타내는",\n        "증명한다", "증명했다", "말해준다", "말해주는",\n        "의미한다", "의미하는", "가져온다", "가져왔다", "가져오는",\n    )\n    hits = 0\n    for s in sents:\n        toks = _all_tokens(s)\n        if not toks:\n            continue\n        head = toks[0]\n        # Subject heuristic: first token, optionally followed by 은/는/이/가.\n        head_stem = head\n        for josa in ("은", "는", "이", "가", "도"):\n            if head.endswith(josa) and len(head) > 1:\n                head_stem = head[:-1]\n                break\n        is_inanimate = (\n            head_stem in inanimate_subjects\n            or (len(head_stem) >= 2 and head_stem[-1] in _HANJA_SUFFIXES_V2)\n        )\n        if not is_inanimate:\n            continue\n        # Verb heuristic: any later token in `universal_verbs`.\n        if any(any(uv in t for uv in universal_verbs) for t in toks[1:]):\n            hits += 1\n    return hits / len(sents)',
    note: '무생물 주어와 만능 서술어를 함께 보되 이대리 문장 분리 방식에 맞춰 다시 짰다.',
  },
];
