import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';

// 분류기 단독 eval 문항 — 「이 말은 어느 워커로 가야 하나」만 본다. 답의 내용은 nl-answer-eval 이 본다.
// 분류기 프롬프트(intent-classifier-system.prompt.ts)나 분류 후보 줄(worker-capability.ts)을 바꾸면
// `pnpm eval:classifier` 로 다시 잰다. 지문 테스트(intent-classifier-system.prompt.spec.ts)가 그 신호다.
//
// 구성: 2026-09-22 기준선(30/30, 문제지는 휘발)과 같은 틀로 재구성한 30문항 — 워커 전부, UNKNOWN,
// 같은 PR 링크에 동사만 바꾼 경계 — 에 원화 공고(ART_JOB_FEED)와 헷갈리는 문항 14개를 더했다.
// 2026-10-16 기록: #852 수정 전 43/44, 수정 후 44/44 (각 2회).
// 새 워커를 넣으면 그 워커의 대표 문장과 함께 "그 기능을 어떻게 쓰는지 묻는 질문"을 대조군으로 넣는다 —
// #852 는 방법 질문이 새 워커의 명령으로 끌려간 사례다.

export interface IntentClassifierEvalCase {
  id: string;
  text: string;
  // 허용하는 분류 결과. 둘 이상이면 어느 쪽도 정답으로 본다.
  accept: Array<AgentType | 'UNKNOWN'>;
  priorTurns?: ConversationTurn[];
}

const PR_URL = 'https://github.com/JSL107/personal_agents/pull/850';

const turn = (
  role: 'user' | 'assistant',
  text: string,
  agentType: AgentType,
): ConversationTurn => ({
  role,
  text,
  agentType,
  agentRunId: null,
  timestampMs: 0,
});

// ArtJobFeedDispatcher 의 목록 되묻기 문구와 같은 형식.
const askArtList = (terms: string): string =>
  `${terms} 키워드를 「허용(제목에 있으면 받기) / 제외(제목에 있으면 거르기) / 화풍(태그만)」 중 한 곳을 골라 주세요. 한 번에 한 목록에만 추가해요. 예: "화풍에 추가"`;

export const INTENT_CLASSIFIER_EVAL_CASES: readonly IntentClassifierEvalCase[] =
  [
    // ── 워커별 대표 문장 ────────────────────────────────────────
    { id: 'pm-plan', text: '내일 plan 짜줘', accept: [AgentType.PM] },
    {
      id: 'pm-todo',
      text: '오늘 뭐부터 하면 좋을까 TODO 정리해줘',
      accept: [AgentType.PM],
    },
    {
      id: 'schedule-register',
      text: '10월 30일 건강검진 예약 등록해줘',
      accept: [AgentType.SCHEDULE],
    },
    {
      id: 'schedule-list',
      text: '다음주 마감 뭐 있어?',
      accept: [AgentType.SCHEDULE],
    },
    {
      id: 'work-reviewer',
      text: '오늘 한 일 정리해줘',
      accept: [AgentType.WORK_REVIEWER],
    },
    // 같은 PR 링크에 동사만 바꾼 경계 3건.
    {
      id: 'code-reviewer',
      text: `${PR_URL} 리뷰해줘`,
      accept: [AgentType.CODE_REVIEWER],
    },
    {
      id: 'impact-reporter',
      text: `${PR_URL} 영향 분석해줘`,
      accept: [AgentType.IMPACT_REPORTER],
    },
    {
      id: 'career-mate-pr',
      text: `${PR_URL} 회고해서 이력서에 녹여줘`,
      accept: [AgentType.CAREER_MATE],
    },
    {
      id: 'po-shadow-prd',
      text: '이 PRD PO 입장에서 검토해줘',
      accept: [AgentType.PO_SHADOW],
    },
    {
      id: 'po-shadow-goal',
      text: '이번 분기 목표 보여줘',
      accept: [AgentType.PO_SHADOW],
    },
    {
      id: 'po-eval',
      text: '이번 주 통합 회고 해줘',
      accept: [AgentType.PO_EVAL],
    },
    {
      id: 'ceo',
      text: '이번 주 메타 평가랑 drift 점검해줘',
      accept: [AgentType.CEO],
    },
    {
      id: 'vacation-balance',
      text: '휴가 며칠 남았어',
      accept: [AgentType.VACATION],
    },
    {
      id: 'vacation-register',
      text: '11월 3일 연차 썼어',
      accept: [AgentType.VACATION],
    },
    {
      id: 'blog',
      text: '서버 컴포넌트 딥다이브 해보자',
      accept: [AgentType.BLOG],
    },
    {
      id: 'blog-publish',
      text: '노션 초안 발행해줘',
      accept: [AgentType.BLOG_PUBLISH],
    },
    {
      id: 'blog-publish-list',
      text: '남은 초안 뭐 있어',
      accept: [AgentType.BLOG_PUBLISH],
    },
    {
      id: 'career-mate-profile',
      text: '내 역량 프로필 정리해줘',
      accept: [AgentType.CAREER_MATE],
    },
    {
      id: 'job-application-status',
      text: '토스 백엔드 서류 합격했어',
      accept: [AgentType.JOB_APPLICATION],
    },
    {
      id: 'job-application-where',
      text: '어디 지원했더라',
      accept: [AgentType.JOB_APPLICATION],
    },
    {
      id: 'paper-trade',
      text: '모의투자 수익률 어때',
      accept: [AgentType.PAPER_TRADE],
    },
    {
      id: 'delay-report',
      text: '요즘 왜 이렇게 느려',
      accept: [AgentType.DELAY_REPORT],
    },
    {
      id: 'video-watch',
      text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ 이거 요약해줘',
      accept: [AgentType.VIDEO_WATCH],
    },
    {
      id: 'art-job-style',
      text: '화풍에 북미풍 추가해줘',
      accept: [AgentType.ART_JOB_FEED],
    },
    {
      id: 'art-job-list',
      text: '원화 공고 키워드 보여줘',
      accept: [AgentType.ART_JOB_FEED],
    },
    {
      id: 'art-job-fetch',
      text: '공고 가져와',
      accept: [AgentType.ART_JOB_FEED],
    },
    // ── UNKNOWN (대화 답변) ─────────────────────────────────────
    { id: 'unknown-thanks', text: '고마워 수고했어', accept: ['UNKNOWN'] },
    { id: 'unknown-dinner', text: '저녁 뭐 먹지?', accept: ['UNKNOWN'] },
    {
      id: 'unknown-capability',
      text: '이대리 봇으로 뭘 할 수 있어?',
      accept: ['UNKNOWN'],
    },
    { id: 'unknown-study', text: '공부하고 싶어', accept: ['UNKNOWN'] },
    // 모의투자는 조회 전용 — 매수 추천은 맡을 워커가 없다.
    {
      id: 'unknown-buy',
      text: '삼성전자 매수 추천해줘',
      accept: ['UNKNOWN'],
    },
    // 계획(PM)과 일정 조회(SCHEDULE) 어느 쪽이든 답이 된다.
    {
      id: 'casual-tomorrow',
      text: '낼 뭐함?',
      accept: [AgentType.PM, AgentType.SCHEDULE],
    },
    // ── 원화 공고와 헷갈리는 문장 — 새 워커가 남의 일을 빼앗는지 본다 ──
    {
      id: 'art-confuser-job-application',
      text: '넥슨게임즈 원화 공고 지원했어',
      accept: [AgentType.JOB_APPLICATION],
    },
    {
      id: 'art-confuser-job-list',
      text: '원화 쪽 지원 현황 보여줘',
      accept: [AgentType.JOB_APPLICATION],
    },
    {
      id: 'art-confuser-schedule',
      text: '시프트업 원화 공고 마감 10월 31일 등록해줘',
      accept: [AgentType.SCHEDULE],
    },
    {
      id: 'art-confuser-today',
      text: '오늘 할 일',
      accept: [AgentType.SCHEDULE],
    },
    {
      id: 'art-confuser-blog-trend',
      text: '게임 원화 포트폴리오 트렌드 조사해서 글로 정리해줘',
      accept: [AgentType.BLOG],
    },
    {
      id: 'art-confuser-blog-style',
      text: '북미풍 캐주얼 아트 스타일 공부할래',
      accept: [AgentType.BLOG],
    },
    // #852: 공고를 빼는 방법 질문은 대화 답변이 「관심 없음」 버튼을 안내한다.
    {
      id: 'art-confuser-howto',
      text: '공고중에서 필요하지 않은 공고를 제외하는 방법 알려줘.',
      accept: ['UNKNOWN'],
    },
    {
      id: 'art-confuser-backend',
      text: '백엔드 채용공고 추천해줘',
      accept: ['UNKNOWN'],
    },
    // ── 직전 대화가 원화 공고일 때 다른 요청이 끌려가지 않는가 ──
    {
      id: 'context-art-then-job-list',
      text: '지원 현황 보여줘',
      accept: [AgentType.JOB_APPLICATION],
      priorTurns: [
        turn(
          'user',
          '[캐주얼 / 북미풍] 키워드도 찾아줬으면 좋겠어!',
          AgentType.ART_JOB_FEED,
        ),
        turn('assistant', askArtList('캐주얼, 북미풍'), AgentType.ART_JOB_FEED),
      ],
    },
    {
      id: 'context-art-then-thanks',
      text: '고마워',
      accept: ['UNKNOWN'],
      priorTurns: [
        turn('user', "'반실사' 키워드도 넣어줘", AgentType.ART_JOB_FEED),
        turn('assistant', askArtList('반실사'), AgentType.ART_JOB_FEED),
      ],
    },
    {
      id: 'context-art-then-schedule',
      text: '내일 할일에 포트폴리오 정리 추가해줘',
      accept: [AgentType.SCHEDULE],
      priorTurns: [
        turn('user', '공고 가져와', AgentType.ART_JOB_FEED),
        turn(
          'assistant',
          '새 공고 2건을 채널에 올렸어요.',
          AgentType.ART_JOB_FEED,
        ),
      ],
    },
    // 일정 되묻기의 단답이 원화 공고 단답 규칙에 끌려가지 않는가.
    {
      id: 'context-schedule-then-title',
      text: '원화 포폴 정리',
      accept: [AgentType.SCHEDULE],
      priorTurns: [
        turn('user', '10월 20일 일정 등록해줘', AgentType.SCHEDULE),
        turn('assistant', '무엇을 등록할까요?', AgentType.SCHEDULE),
      ],
    },
  ];
