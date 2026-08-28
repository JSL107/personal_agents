import { AgentType } from '../model-router/domain/model-router.type';
import { evaluateContract, inspectContract } from './contract-inspector';

describe('inspectContract', () => {
  describe('missingField — 산출물 필수 필드', () => {
    it('계약이 요구한 키가 없으면 위반으로 잡는다', () => {
      // PM 계약: topPriority / morning / afternoon
      const violations = inspectContract(AgentType.PM, {
        // 근거(#193)를 넣어 noEvidence 를 배제하고 필드 검사만 격리한다.
        topPriority: '오늘의 최우선 과제 #193',
        morning: '오전 계획',
        // afternoon 누락
      });

      expect(violations).toEqual([
        { rule: 'missingField', detail: 'afternoon' },
      ]);
    });

    it('키가 있어도 값이 null 이거나 빈 문자열이면 위반으로 잡는다', () => {
      const violations = inspectContract(AgentType.PM, {
        topPriority: null,
        morning: '   ',
        afternoon: '오후 계획 https://example.com/task',
      });

      expect(violations).toEqual([
        { rule: 'missingField', detail: 'topPriority' },
        { rule: 'missingField', detail: 'morning' },
      ]);
    });

    it('빈 배열·빈 객체는 위반으로 잡지 않는다 (정상적으로 비어 있을 수 있음)', () => {
      // IMPACT_REPORTER 의 quantitative 는 실제로 빈 배열인 경우가 있다.
      const violations = inspectContract(AgentType.IMPACT_REPORTER, {
        headline: '요약 한 줄',
        quantitative: [],
        qualitative: {},
      });

      expect(violations).toEqual([]);
    });

    it('계약의 deliverableFields 가 비어 있으면 필드 검사를 건너뛴다', () => {
      // VACATION 은 usecase 마다 산출물 형태가 달라 공통 필수 키가 없다.
      const violations = inspectContract(AgentType.VACATION, { anything: 1 });

      expect(violations).toEqual([]);
    });

    it('계약이 스텁이면 산출물이 객체가 아니어도 검사를 건너뛴다', () => {
      // ISSUE_LABELER 는 배열을 그대로 내보낸다 — 계약이 없으니 형식 오류가 아니다.
      expect(inspectContract(AgentType.ISSUE_LABELER, ['a', 'b'])).toEqual([]);
      expect(inspectContract(AgentType.ISSUE_LABELER, null)).toEqual([]);
    });

    it('계약이 요구하는 것이 있는데 객체가 아니면 전부 누락으로 보고한다', () => {
      // 건너뛰면 형식 오류가 "무검사" 로 집계돼 숨는다(PR #374 리뷰 지적).
      expect(inspectContract(AgentType.PM, ['a', 'b'])).toEqual([
        { rule: 'missingField', detail: 'topPriority' },
        { rule: 'missingField', detail: 'morning' },
        { rule: 'missingField', detail: 'afternoon' },
        { rule: 'noEvidence', detail: AgentType.PM },
      ]);
    });
  });

  describe('forbiddenPhrase — 금칙어', () => {
    it('회사 공통 금칙어가 산출물에 있으면 위반으로 잡는다', () => {
      const violations = inspectContract(AgentType.WORK_REVIEWER, {
        summary: '오늘은 마법 같은 하루였다',
        oneLineAchievement: '한 줄 성과',
        nextActions: ['다음 할 일'],
      });

      expect(violations).toEqual([
        { rule: 'forbiddenPhrase', detail: '마법 같은' },
      ]);
    });

    it('중첩된 값 안의 금칙어도 잡는다', () => {
      const violations = inspectContract(AgentType.WORK_REVIEWER, {
        summary: '요약',
        oneLineAchievement: '한 줄 성과',
        nextActions: ['함께 알아볼까요'],
      });

      expect(violations).toEqual([
        { rule: 'forbiddenPhrase', detail: '함께 알아볼까요' },
      ]);
    });
  });

  describe('noEvidence — 근거 요구', () => {
    it('근거를 요구하는 계약인데 근거가 하나도 없으면 위반으로 잡는다', () => {
      const violations = inspectContract(AgentType.PM, {
        topPriority: '근거 없는 최우선 과제',
        morning: '오전',
        afternoon: '오후',
      });

      expect(violations).toEqual([{ rule: 'noEvidence', detail: 'PM' }]);
    });

    it.each([
      ['URL', 'https://github.com/foo/bar/pull/1'],
      ['PR 참조', '#193 후속 작업'],
      ['파일:라인', 'src/agent/pm/pm.usecase.ts:42 확인'],
    ])('%s 형태의 근거를 인식한다', (_label, evidence) => {
      const violations = inspectContract(AgentType.PM, {
        topPriority: evidence,
        morning: '오전',
        afternoon: '오후',
      });

      expect(violations).toEqual([]);
    });

    it('구조화 근거 필드의 값이 비어 있으면 근거로 인정하지 않는다', () => {
      // pr-review.parser.ts 는 빈 문자열 file 을 허용한다. 키 존재만 보면
      // 근거 없는 산출물이 통과해 관측 통계에 false negative 가 쌓인다.
      const violations = inspectContract(AgentType.CODE_REVIEWER, {
        summary: '리뷰 요약',
        findings: [{ body: '지적 내용', file: '', line: 0 }],
        approvalRecommendation: 'REQUEST_CHANGES',
      });

      expect(violations).toEqual([
        { rule: 'noEvidence', detail: 'CODE_REVIEWER' },
      ]);
    });

    it('구조화된 근거 필드(file/line)를 인식한다', () => {
      // CODE_REVIEWER 는 근거를 텍스트가 아니라 findings[].file 로 담는다.
      const violations = inspectContract(AgentType.CODE_REVIEWER, {
        summary: '리뷰 요약',
        findings: [{ body: '지적 내용', file: 'src/foo.ts', line: 158 }],
        approvalRecommendation: 'REQUEST_CHANGES',
      });

      expect(violations).toEqual([]);
    });

    it('목록형 산출물이 전부 비어 있으면 근거를 요구하지 않는다', () => {
      // 지적 0건으로 승인한 리뷰 — 근거를 붙일 대상 자체가 없다.
      // 2026-08-03 실측에서 CODE_REVIEWER noEvidence 4건이 전부 이 형태였다.
      const violations = inspectContract(AgentType.CODE_REVIEWER, {
        summary: '머지를 막을 문제는 확인되지 않았습니다',
        findings: [],
        mustFix: [],
        approvalRecommendation: 'approve',
      });

      expect(violations).toEqual([]);
    });

    it('목록이 하나라도 차 있으면 근거를 요구한다', () => {
      const violations = inspectContract(AgentType.CODE_REVIEWER, {
        summary: '리뷰 요약',
        findings: [{ body: '어딘가 이상하다' }],
        mustFix: [],
        approvalRecommendation: 'REQUEST_CHANGES',
      });

      expect(violations).toEqual([
        { rule: 'noEvidence', detail: 'CODE_REVIEWER' },
      ]);
    });

    it('claimFields 가 없는 계약은 빈 배열이 있어도 면제되지 않는다', () => {
      // PM 은 morning·afternoon 이 빈 배열이어도 topPriority 라는 주장이 남는다.
      // 배열이 비었다는 이유로 면제하면 근거 없는 최우선 과제가 통과한다.
      const violations = inspectContract(AgentType.PM, {
        topPriority: '근거 없는 최우선 과제',
        morning: [],
        afternoon: [],
      });

      expect(violations).toEqual([{ rule: 'noEvidence', detail: 'PM' }]);
    });

    it('근거를 요구하지 않는 계약이면 근거가 없어도 통과한다', () => {
      const violations = inspectContract(AgentType.WORK_REVIEWER, {
        summary: '요약',
        oneLineAchievement: '한 줄 성과',
        nextActions: ['다음 할 일'],
      });

      expect(violations).toEqual([]);
    });
  });

  it('위반이 여러 종류면 모두 보고한다', () => {
    const violations = inspectContract(AgentType.PM, {
      topPriority: '마법 같은 과제',
      morning: '오전',
      // afternoon 누락 + 근거 없음
    });

    expect(violations).toEqual([
      { rule: 'missingField', detail: 'afternoon' },
      { rule: 'forbiddenPhrase', detail: '마법 같은' },
      { rule: 'noEvidence', detail: 'PM' },
    ]);
  });
});

describe('evaluateContract — 점수', () => {
  it('필수 필드가 전부 채워지고 근거가 있으면 만점이다', () => {
    // PM 계약: 필드 3 개 + 근거 요구 1 개 = 검사 4 항목.
    const evaluation = evaluateContract(AgentType.PM, {
      topPriority: '오늘의 최우선 과제 #193',
      morning: '오전 계획',
      afternoon: '오후 계획',
    });

    expect(evaluation.checkedCount).toBe(4);
    expect(evaluation.passedCount).toBe(4);
    expect(evaluation.score).toBe(1);
    expect(evaluation.violations).toEqual([]);
  });

  it('필드 하나가 비면 부분 점수를 준다 — 위반 유무로는 안 보이는 해상도다', () => {
    const evaluation = evaluateContract(AgentType.PM, {
      topPriority: '오늘의 최우선 과제 #193',
      morning: '오전 계획',
      afternoon: '',
    });

    // 4 항목 중 3 통과.
    expect(evaluation.score).toBeCloseTo(0.75);
  });

  it('필드가 전부 비면 하나만 빈 경우보다 점수가 낮다', () => {
    const one = evaluateContract(AgentType.PM, {
      topPriority: '최우선 #193',
      morning: '오전',
      afternoon: '',
    });
    const all = evaluateContract(AgentType.PM, {
      topPriority: '',
      morning: '',
      afternoon: '',
      note: '근거 #193',
    });

    // 둘 다 inspectContract 로는 "위반 있음" 한 가지로 뭉개진다.
    expect(one.violations.length).toBeGreaterThan(0);
    expect(all.violations.length).toBeGreaterThan(0);
    expect(all.score).toBeLessThan(one.score as number);
  });

  it('검사 항목이 0 개인 스텁 계약은 점수를 null 로 남긴다 (만점 아님)', () => {
    // CONTRADICTION_JUDGE 는 실행 이력이 없어 스텁으로 남긴 계약이다.
    const evaluation = evaluateContract(AgentType.CONTRADICTION_JUDGE, {
      anything: '값',
    });

    expect(evaluation.checkedCount).toBe(0);
    expect(evaluation.score).toBeNull();
  });

  it('계약이 요구하는 것이 있는데 객체가 아니면 형식 오류로 0 점을 준다', () => {
    // null 로 두면 "계약이 스텁이라 무검사" 와 같은 값이 되어 형식 오류가 숨는다.
    for (const broken of [['배열'], null, '문자열', 42]) {
      const evaluation = evaluateContract(AgentType.PM, broken);

      expect(evaluation.score).toBe(0);
      // PM 은 필드 3 개 + 근거 요구 1 개.
      expect(evaluation.checkedCount).toBe(4);
      expect(evaluation.passedCount).toBe(0);
      expect(evaluation.violations).toEqual([
        { rule: 'missingField', detail: 'topPriority' },
        { rule: 'missingField', detail: 'morning' },
        { rule: 'missingField', detail: 'afternoon' },
        { rule: 'noEvidence', detail: AgentType.PM },
      ]);
    }
  });

  it('스텁 계약은 객체가 아니어도 그대로 무검사(null)로 남긴다', () => {
    // REVIEW_REPLY_JUDGE 는 배열을 그대로 내보낸다 — 계약이 없으니 형식 오류가 아니다.
    const evaluation = evaluateContract(AgentType.REVIEW_REPLY_JUDGE, [
      { accepted: true },
    ]);

    expect(evaluation.score).toBeNull();
    expect(evaluation.violations).toEqual([]);
  });

  it('금칙어는 분모를 늘리지 않고 분자에서만 깎는다', () => {
    const clean = evaluateContract(AgentType.CTO, {
      ctoSummary: '분배 요약',
      assignments: ['a'],
      unassignedTasks: [],
    });
    const dirty = evaluateContract(AgentType.CTO, {
      ctoSummary: '마법 같은 분배 요약',
      assignments: ['a'],
      unassignedTasks: [],
    });

    // 분모가 같아야 한다 — 금칙어가 항목으로 세어지면 깨끗한 산출물이 공짜 1 점을 받는다.
    expect(dirty.checkedCount).toBe(clean.checkedCount);
    expect(clean.score).toBe(1);
    expect(dirty.score).toBeLessThan(1);
  });

  it('금칙어가 필드 수보다 많아도 점수가 음수로 내려가지 않는다', () => {
    const evaluation = evaluateContract(AgentType.HUMANIZER, {
      // 필수 필드는 humanizedKeys 하나뿐인데 금칙어는 두 개 들어 있다.
      humanizedKeys: ['마법 같은', '놀라운 변화'],
    });

    expect(evaluation.score).toBe(0);
    // 필드 자체는 통과했다 — 0 이 된 것은 금칙어 감점 때문이고, 그 구분이 남아야 한다.
    expect(evaluation.passedCount).toBe(1);
  });

  it('근거 요구가 면제되면 분모에서도 빠진다', () => {
    // CODE_REVIEWER: 지적이 없는 승인 리뷰는 근거를 붙일 대상이 없다.
    const evaluation = evaluateContract(AgentType.CODE_REVIEWER, {
      summary: '변경 없음 승인',
      findings: [],
      mustFix: [],
      approvalRecommendation: 'APPROVE',
    });

    // 필드 3 개만 세고 근거 항목은 빠져야 한다.
    expect(evaluation.checkedCount).toBe(3);
    expect(evaluation.score).toBe(1);
  });

  // PAPER_TRADE 는 성격이 다른 워커 셋이 나눠 쓰는 이름이다. 계약이 일일 평가 형태만 알고
  // 있던 동안 장중 손절의 성공 실행 167 건이 전부 "필수 필드 3 개 누락" 으로 찍혔다.
  describe('산출물 형태가 여러 갈래인 계약', () => {
    // 2026-08-28 원장에서 그대로 가져온 형태다(값만 축약).
    const dailyEvaluationOutput = {
      accounts: [{ accountId: 1, name: 'LONG_TERM' }],
      accountCount: 1,
      failedCount: 0,
    };
    const intradayStopOutput = {
      inspectedCount: 6,
      decidedCount: 0,
      filledCount: 0,
      notTradedCount: 0,
      priceErrorCount: 0,
      accountFailures: [],
    };

    it('일일 평가 형태를 만점으로 인정한다', () => {
      const evaluation = evaluateContract(
        AgentType.PAPER_TRADE,
        dailyEvaluationOutput,
      );

      expect(evaluation.violations).toEqual([]);
      expect(evaluation.score).toBe(1);
    });

    it('장중 손절 형태도 만점으로 인정한다', () => {
      const evaluation = evaluateContract(
        AgentType.PAPER_TRADE,
        intradayStopOutput,
      );

      expect(evaluation.violations).toEqual([]);
      expect(evaluation.score).toBe(1);
    });

    // 후보를 여럿 두면 검사가 헐거워질 수 있다 — 어느 형태에도 못 맞는 산출물은 여전히
    // 위반으로 잡혀야 한다. 그러지 않으면 이 필드가 "검사 포기" 와 같아진다.
    it('어느 형태에도 맞지 않으면 그대로 위반이다', () => {
      const evaluation = evaluateContract(AgentType.PAPER_TRADE, {
        somethingElse: 1,
      });

      expect(evaluation.score).toBe(0);
      expect(evaluation.violations).toHaveLength(3);
    });

    // 채점은 가장 부합하는 후보 하나로 한다. 두 형태의 분모를 합치면 늘 절반이 누락으로 남는다.
    it('부분 일치는 더 잘 맞는 형태를 기준으로 센다', () => {
      const evaluation = evaluateContract(AgentType.PAPER_TRADE, {
        inspectedCount: 6,
        decidedCount: 1,
      });

      expect(evaluation.checkedCount).toBe(3);
      expect(evaluation.passedCount).toBe(2);
      expect(evaluation.violations).toEqual([
        { rule: 'missingField', detail: 'filledCount' },
      ]);
    });
  });

  it('inspectContract 는 같은 검수의 위반 목록과 일치한다', () => {
    const output = { topPriority: '', morning: '오전', afternoon: '오후' };

    expect(inspectContract(AgentType.PM, output)).toEqual(
      evaluateContract(AgentType.PM, output).violations,
    );
  });
});
