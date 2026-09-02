import { StudyBriefVerdict } from './study-brief.type';
import { StudyResearchKind } from './study-research.parser';

export interface StudyDeepdiveRepoModule {
  name: string;
  description: string;
}

export interface BuildStudyDeepdivePromptInput {
  kind: StudyResearchKind;
  topic: string;
  verdict: StudyBriefVerdict;
  briefMd: string;
  sourceUrls: readonly string[];
  repoModules: readonly StudyDeepdiveRepoModule[];
}

// 오늘의 공부(15분 분량 요약)를 블로그 글로 펼치는 프롬프트.
//
// 원본 조사 프롬프트(study-brief-cron.type.ts)와 **지시가 정반대**다. 그쪽은 Slack 카드에
// 담으려고 "1,200~1,800자로 압축, 읽은 것을 전부 옮기지 마라" 로 잘라냈고, 그 압축본이
// 블로그에 올리기엔 얕다는 것이 이 확장의 출발점이다. 여기서는 같은 출처를 다시 열어
// 배경·차이·한계까지 펼친다.
//
// 문체는 손대지 않는다 — 발행 라인(publish-notion-draft.usecase.ts)이 익명화·편집 뒤
// humanizeMarkdownProse 로 사용자 말투를 입힌다. 여기서 미리 흉내 내면 두 번 윤문돼 어긋난다.
//
// **구조는 여기서 정해진다.** 문장을 다듬는 것은 윤문이 하지만, 소제목을 몇 개로 나눌지와
// 한 갈래를 얼마나 길게 끌지는 이 프롬프트의 몫이고 윤문은 그것을 바꾸지 않는다.
//
// 소제목당 600자는 참조 코퍼스 실측이다(`scripts/fetch-reference-corpus.ts`, 2026-09-02) —
// 한국 기술 블로그의 소제목당 분량 중앙값이 토스 622자 · 우아한형제들 538자 · 네이버 D2 386자
// 인데, 우리 발행본은 907자였다. 같은 분량을 절반의 소제목으로 끌고 가면 한 절이 두 가지
// 이야기를 품게 되고, 읽는 사람은 어디서 화제가 바뀌었는지 표지 없이 따라가야 한다.
// (하이퍼커넥트는 1,380자로 반대쪽 끝이라 중앙값 계산에서 방향만 참고했다.)
export const buildStudyDeepdivePrompt = ({
  kind,
  topic,
  verdict,
  briefMd,
  sourceUrls,
  repoModules,
}: BuildStudyDeepdivePromptInput): string =>
  [
    `아래 주제로 기술 블로그 글 한 편을 써라. 이미 15분 분량으로 압축해 둔 조사 요약이 있고, 그것을 제대로 된 글로 펼치는 작업이다.`,
    '',
    `[주제] ${topic} (${kind === 'CONCEPT' ? '개념' : '도구'})`,
    '',
    '[왜 이 주제를 골랐나]',
    ...buildVerdictLines(verdict),
    '',
    '[압축된 조사 요약 — 출발점이지 결과물이 아니다]',
    briefMd,
    '',
    '[출처 — 반드시 다시 열어 읽어라]',
    sourceUrls.length > 0
      ? sourceUrls.map((url) => `- ${url}`).join('\n')
      : '(없음 — 주제로 직접 검색해 공식 문서·공식 레포를 찾아 읽어라)',
    '필요하면 출처를 더 찾아도 된다. 공식 문서와 공식 레포를 우선한다.',
    '',
    '[글쓴이의 시스템 — 마지막 절의 재료]',
    'TypeScript·NestJS 백엔드 개발자이고, Slack 기반 LLM 멀티 에이전트 시스템을 직접 만들어 운영한다.',
    '그 시스템의 모듈 목록이다. 이 중 이번 주제와 실제로 맞닿는 것만 골라 쓴다.',
    repoModules.length > 0
      ? repoModules
          .map((module) =>
            module.description
              ? `- ${module.name}: ${module.description}`
              : `- ${module.name}`,
          )
          .join('\n')
      : '(수집 실패 — 이 경우 마지막 절은 일반적인 적용 지점으로 쓴다)',
    '',
    '[분량과 구조]',
    '본문 4,000~6,000자. 압축하지 마라 — 압축본은 이미 있고, 그것으로는 부족해서 이 글을 쓴다.',
    '소제목은 `## ` 만 쓴다. `# ` 는 쓰지 마라(글 제목은 따로 붙는다).',
    '소제목 하나가 다루는 분량은 600자 안팎이다. 900자를 넘어가면 그 안에서 이야기가 두 갈래로 갈린 것이니 소제목을 나눠라.',
    '아래 흐름을 따르되 소제목 문구는 주제에 맞게 직접 정한다. 여섯 갈래가 각각 소제목 하나여야 하는 것은 아니다 — 길어지는 갈래는 나누고, 짧은 갈래는 이웃과 합쳐라.',
    '1. 어떤 문제 상황에서 이게 필요해지는지. 개념 정의로 시작하지 마라.',
    '2. 이게 실제로 무엇인지 — 배경, 그리고 기존 방식과 무엇이 다른지.',
    '3. 어떻게 동작하는지. 출처에서 확인한 구체적인 내용으로.',
    '4. 한계와 성숙도. 언제 쓰면 안 되는지까지.',
    '5. 글쓴이의 시스템에 대입하면 어디에 닿는지. 위 모듈 목록에서 고른 실제 이름을 쓴다.',
    '6. 다음에 확인할 것 한두 가지.',
    '',
    '[지켜야 할 것]',
    '- 출처에서 확인한 것만 쓴다. 확인하지 못한 수치·날짜·API 이름은 쓰지 말고, 애매하면 그 자리를 비워라.',
    '- 코드·설정·요청 예시를 최소 두 곳에 넣어라. 개념만 설명하고 실물을 보여주지 않으면 읽는 사람이 확인할 수 없다.',
    '- 그 예시는 출처에 실제로 있는 것만 옮긴다. 출처에 없으면 지어내지 말고 대신 출처가 규정한 형식·필드 이름을 그대로 인용하라.',
    '- 예시는 ``` 로 감싼 코드블록에 넣고 언어를 표시한다(```ts, ```http, ```bash 등).',
    '- 회사명·학교명·사내 시스템 이름·업무 데이터는 쓰지 마라. 이 글은 공개 저장소에 발행된다.',
    '- 요약 재탕 금지. 위 조사 요약에 이미 있는 문장을 그대로 옮기지 말고, 출처를 읽어 알아낸 것을 더해라.',
    '',
    '[출력 형식 — 문자 그대로 준수]',
    'TITLE: 글 제목 (한국어, 40자 이내)',
    'TAGS: 태그3~5개를 쉼표로 구분 (영문 소문자 또는 한국어 단어)',
    '---',
    '<본문 마크다운>',
  ].join('\n');

const buildVerdictLines = (verdict: StudyBriefVerdict): string[] => {
  if (verdict.kind === 'CONCEPT') {
    return [
      `- 왜 지금 필요한가: ${verdict.whyNow}`,
      `- 어디에 닿나: ${verdict.whereItLands}`,
    ];
  }
  const lines = [
    `- 무엇이 좋아지나: ${verdict.whatImproves}`,
    `- 도입 비용: ${verdict.adoptionCost}`,
  ];
  if (verdict.caution !== undefined) {
    lines.push(`- 주의: ${verdict.caution}`);
  }
  return lines;
};
