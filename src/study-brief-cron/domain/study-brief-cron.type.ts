import { StudyResearchKind } from './study-research.parser';

export const STUDY_BRIEF_CRON_QUEUE = 'study-brief-cron';
export const DEFAULT_STUDY_BRIEF_CRON = '30 9 * * *';
export const DEFAULT_STUDY_BRIEF_TIMEZONE = 'Asia/Seoul';

export interface StudyBriefCronJobData {
  ownerSlackUserId: string;
  target: string;
}

export type StudyKindBalance = Record<StudyResearchKind, number>;

export interface BuildStudyResearchPromptInput {
  profileSkills: readonly string[] | undefined;
  recentTopics: readonly string[];
  kindBalance: StudyKindBalance;
  installedTools: readonly string[];
}

export const buildStudyResearchPrompt = ({
  profileSkills,
  recentTopics,
  kindBalance,
  installedTools,
}: BuildStudyResearchPromptInput): string => {
  const identity =
    profileSkills !== undefined && profileSkills.length > 0
      ? profileSkills.map((skill) => `- ${skill}`).join('\n')
      : 'TypeScript·NestJS 백엔드 개발자, LLM 에이전트 시스템을 만든다';
  const balanceInstruction = buildBalanceInstruction(kindBalance);

  return [
    'AI·LLM·에이전트 기술 중 이 사람의 다음 단계에 필요한 주제 한 건을 딥다이브 조사하라.',
    '최신성을 우선하되 이 사람에게 필요한지가 더 중요하다.',
    '',
    '[누구인가]',
    identity,
    '',
    '[최근 30일 제외 목록]',
    '아래와 사실상 같은 주제는 제외하라. 표기가 달라도 같은 것으로 취급한다. 예: MCP와 Model Context Protocol.',
    recentTopics.length > 0
      ? recentTopics.map((topic) => `- ${topic}`).join('\n')
      : '(없음)',
    '',
    '[이미 설치·연결한 도구]',
    '이미 설치·연결되어 있으므로 TOOL 후보에서 제외하라.',
    installedTools.length > 0
      ? installedTools.map((tool) => `- ${tool}`).join('\n')
      : '(없음)',
    '',
    `[최근 5건 kind 분포] CONCEPT=${kindBalance.CONCEPT}, TOOL=${kindBalance.TOOL}`,
    balanceInstruction,
    '',
    '[조사 깊이]',
    '공식 문서·공식 레포·신뢰할 기술 글을 실제로 열어 읽어라. 헤드라인 요약은 금지한다.',
    '여러 자료에서 개념, 배경, 기존 방식과 차이, 성숙도, 한계를 확인하되 읽은 것을 전부 본문에 옮기지 마라.',
    '',
    '[출력 분량과 구조]',
    '조사 본문은 1,200~1,800자로 압축한다. 이 사람에게 필요한 내용만 남긴다.',
    '아래 세 섹션만 사용하고 다른 헤딩을 만들지 마라.',
    '## 세 줄 요약',
    '이게 뭔지 · 기존과 뭐가 다른지 · 왜 지금 이 사람에게 필요한지. 세 문장.',
    '',
    '## 알아야 할 것',
    '불릿 4~5개. 각 2줄 이내. 개념의 핵심만 쓰고 역사·경쟁 제품 비교·세부 스펙은 넣지 마라.',
    '',
    '## 오늘 할 일',
    '15분 안에 끝나는 구체 행동 하나. 어느 문서의 어느 절을 읽고 무엇을 확인할지까지 쓴다.',
    '더 파고들 자료는 본문이 아니라 SOURCES에 넣어라.',
    '',
    '[출력 형식 — 문자 그대로 준수]',
    '소재가 있으면:',
    'KIND: CONCEPT',
    'TOPIC: 주제명',
    'SOURCES: https://a.example/doc, https://b.example/post',
    '---',
    '<조사 본문 마크다운>',
    '',
    'KIND는 CONCEPT 또는 TOOL만 허용한다.',
    '소재가 없으면 첫 줄 하나만 출력한다:',
    'NO_TOPIC: <왜 없는지 한 문장>',
  ].join('\n');
};

const buildBalanceInstruction = (kindBalance: StudyKindBalance): string => {
  if (kindBalance.CONCEPT >= 4) {
    return '최근 CONCEPT가 4건 이상이므로 TOOL을 우선하라. 단, 적합한 소재가 없으면 강제하지 않는다.';
  }
  if (kindBalance.TOOL >= 4) {
    return '최근 TOOL이 4건 이상이므로 CONCEPT를 우선하라. 단, 적합한 소재가 없으면 강제하지 않는다.';
  }
  return '한쪽 kind를 강제하지 말고 가장 필요한 주제를 고른다.';
};
