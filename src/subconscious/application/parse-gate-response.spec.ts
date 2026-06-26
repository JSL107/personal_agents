import { AgentType } from '../../model-router/domain/model-router.type';
import { parseGateResponse } from './parse-gate-response';

describe('parseGateResponse', () => {
  const valid = new Set(['github:pr:o/r#1']);

  it('정상 JSON 배열을 GateDecision 으로 매핑', () => {
    const raw = JSON.stringify([
      {
        changeKey: 'github:pr:o/r#1',
        promote: true,
        reason: 'review 요청',
        suggestedAgentType: 'CODE_REVIEWER',
        proposalText: 'PR #1 리뷰할까요?',
      },
    ]);
    const result = parseGateResponse(raw, valid);
    expect(result[0]).toEqual(
      expect.objectContaining({
        promote: true,
        suggestedAgentType: AgentType.CODE_REVIEWER,
      }),
    );
  });

  it('파싱 불가 입력은 빈 배열(fail-closed)', () => {
    expect(parseGateResponse('not json', valid)).toEqual([]);
    expect(parseGateResponse('```\n{}\n```', valid)).toEqual([]);
  });

  it('validKeys 밖 changeKey 는 제거', () => {
    const raw = JSON.stringify([{ changeKey: 'unknown', promote: true }]);
    expect(parseGateResponse(raw, valid)).toEqual([]);
  });

  it('알 수 없는 suggestedAgentType 은 undefined 로', () => {
    const raw = JSON.stringify([
      {
        changeKey: 'github:pr:o/r#1',
        promote: true,
        suggestedAgentType: 'NOPE',
      },
    ]);
    expect(parseGateResponse(raw, valid)[0].suggestedAgentType).toBeUndefined();
  });
});
