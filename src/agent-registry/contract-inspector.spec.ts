import { AgentType } from '../model-router/domain/model-router.type';
import { inspectContract } from './contract-inspector';

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

    it('산출물이 객체가 아니면 필드 검사를 건너뛴다', () => {
      // ISSUE_LABELER 는 배열을 그대로 내보낸다.
      expect(inspectContract(AgentType.PM, ['a', 'b'])).toEqual([]);
      expect(inspectContract(AgentType.PM, 'plain text')).toEqual([]);
      expect(inspectContract(AgentType.PM, null)).toEqual([]);
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

    it('계약과 무관한 부수 배열이 비어 있어도 면제되지 않는다', () => {
      // PM 계약의 topPriority/morning/afternoon 은 전부 문자열이다. 계약이 목록으로
      // 내라고 한 것이 없으므로 "주장 없음" 을 판정할 근거가 없고, 산출물에 딸린
      // 부수 배열(notes)이 비었다는 이유로 근거 요구가 꺼져서는 안 된다.
      const violations = inspectContract(AgentType.PM, {
        topPriority: '근거 없는 최우선 과제',
        morning: '오전',
        afternoon: '오후',
        notes: [],
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
