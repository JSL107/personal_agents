import { AgentType } from '../../model-router/domain/model-router.type';
import { AGENT_SAFETY_LEVEL, AgentSafetyLevel } from './agent-safety.map';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from './prompt/intent-classifier-system.prompt';

describe('agent-safety.map', () => {
  it('모든 AgentType 에 등급이 있다 — 누락이 READ_ONLY 로 위장되지 않는다', () => {
    const missing = Object.values(AgentType).filter(
      (agentType) => AGENT_SAFETY_LEVEL[agentType] === undefined,
    );
    expect(missing).toEqual([]);
  });

  // 등급 판정 근거(실측):
  //  - VACATION: registerLeave / cancelLeave 로 사용자 휴가 기록을 쓴다
  //  - JOB_APPLICATION: addApplication / updateApplication 으로 지원 기록을 쓴다
  //  - BLOG: Notion 초안 페이지를 만들고 상태를 갱신한다
  //  - BLOG_PUBLISH: 익명화한 초안을 GitHub Pages 로 발행한다
  //  - PAPER_RECOMMEND: saveRecommendationAtomically 로 추천·모의 주문을 트랜잭션 저장한다
  //  - ISSUE_LABELER: issues.addLabels 로 레포 이슈를 바꾼다
  it.each([
    [AgentType.VACATION, AgentSafetyLevel.WRITE],
    [AgentType.JOB_APPLICATION, AgentSafetyLevel.WRITE],
    [AgentType.BLOG, AgentSafetyLevel.WRITE],
    [AgentType.PAPER_RECOMMEND, AgentSafetyLevel.WRITE],
    [AgentType.BLOG_PUBLISH, AgentSafetyLevel.IRREVERSIBLE],
    [AgentType.ISSUE_LABELER, AgentSafetyLevel.IRREVERSIBLE],
  ])('%s 는 %s 등급이다', (agentType, expected) => {
    expect(AGENT_SAFETY_LEVEL[agentType]).toBe(expected);
  });

  // CODE_REVIEWER 는 문서만 낸다 — GitHub 게시는 별도 스윕(PR_REVIEW_INLINE_REPOS)의 몫이라
  // 이 worker 자체는 읽기 전용이다. CAREER_MATE 의 사이트 발행도 autopilot cron 전용이라
  // 자연어 라우팅으로 도달하지 않는다.
  it.each([AgentType.CODE_REVIEWER, AgentType.CAREER_MATE, AgentType.PM])(
    '%s 는 문서 산출물만 내므로 READ_ONLY 다',
    (agentType) => {
      expect(AGENT_SAFETY_LEVEL[agentType]).toBe(AgentSafetyLevel.READ_ONLY);
    },
  );

  // 등급 맵과 분류 프롬프트가 갈리지 않게 묶는다. 등급만 바꾸고 프롬프트 표식을 빠뜨리면
  // 분류기는 그 worker 가 기록을 남긴다는 사실을 모른 채 고르게 된다 — 선언이 집행과 갈리는 자리.
  describe('분류 프롬프트 ⚠️ 표식 동기화', () => {
    // 프롬프트의 "분류 후보" 목록에 실제로 등장하는 worker 만 대상.
    // (ISSUE_LABELER 는 webhook 전용이라 자연어 분류 후보가 아니다.)
    const listedInPrompt = (agentType: AgentType): boolean =>
      new RegExp(`^- ${agentType}: `, 'mu').test(
        INTENT_CLASSIFIER_SYSTEM_PROMPT,
      );

    const hasWarningMark = (agentType: AgentType): boolean =>
      new RegExp(`^- ${agentType}: ⚠️`, 'mu').test(
        INTENT_CLASSIFIER_SYSTEM_PROMPT,
      );

    it('기록을 남기는 worker 는 프롬프트에 ⚠️ 표식이 있다', () => {
      const missingMark = Object.values(AgentType)
        .filter(listedInPrompt)
        .filter(
          (agentType) =>
            AGENT_SAFETY_LEVEL[agentType] !== AgentSafetyLevel.READ_ONLY,
        )
        .filter((agentType) => !hasWarningMark(agentType));
      expect(missingMark).toEqual([]);
    });

    it('READ_ONLY worker 에는 ⚠️ 표식이 붙지 않는다 — 표식이 흔해지면 뜻을 잃는다', () => {
      const wrongMark = Object.values(AgentType)
        .filter(listedInPrompt)
        .filter(
          (agentType) =>
            AGENT_SAFETY_LEVEL[agentType] === AgentSafetyLevel.READ_ONLY,
        )
        .filter(hasWarningMark);
      expect(wrongMark).toEqual([]);
    });

    // 자연어 분류 후보로 올린 worker 는 실행 경로가 열린 것이므로, 행동을 실측해
    // 등급을 확정해야 한다. UNAUDITED 인 채로 후보에 오르면 "무엇이 남는지 모르는 worker"
    // 가 자연어 한 마디로 실행될 수 있다.
    it('분류 후보로 올라온 worker 는 UNAUDITED 로 남아 있지 않다', () => {
      const unaudited = Object.values(AgentType)
        .filter(listedInPrompt)
        .filter(
          (agentType) =>
            AGENT_SAFETY_LEVEL[agentType] === AgentSafetyLevel.UNAUDITED,
        );
      expect(unaudited).toEqual([]);
    });
  });
});
