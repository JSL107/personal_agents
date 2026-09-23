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
    const result = parseGateResponse(raw, valid) ?? [];
    expect(result[0]).toEqual(
      expect.objectContaining({
        promote: true,
        suggestedAgentType: AgentType.CODE_REVIEWER,
      }),
    );
  });

  // 2026-09-17~19 사고의 재현. codex 쿼터 소진으로 claude 폴백을 탄 86 회차가 전건
  // `decisions: []` 로 적재됐다 — 응답이 코드펜스에 싸여 `JSON.parse` 가 통째로 터졌다.
  // 같은 레포의 다른 배열 파서(`verdict-batch.parser.ts`)는 이미 공용 추출기를 쓴다.
  it('코드펜스로 감싼 배열을 읽는다', () => {
    const inner = JSON.stringify([
      { changeKey: 'github:pr:o/r#1', promote: true, reason: 'review 요청' },
    ]);
    expect(
      parseGateResponse(`\`\`\`json\n${inner}\n\`\`\``, valid),
    ).toHaveLength(1);
    expect(parseGateResponse(`\`\`\`\n${inner}\n\`\`\``, valid)).toHaveLength(
      1,
    );
  });

  it('앞뒤 설명이 붙은 배열을 읽는다', () => {
    const inner = JSON.stringify([
      { changeKey: 'github:pr:o/r#1', promote: false, reason: '노이즈' },
    ]);
    const raw = `판정 결과입니다:\n\`\`\`json\n${inner}\n\`\`\`\n이상입니다.`;
    expect(parseGateResponse(raw, valid)).toHaveLength(1);
  });

  // `null`(응답에서 배열을 못 뽑음) 과 `[]`(뽑았으나 유효 항목이 없음) 를 가른다.
  // 둘을 같은 값으로 두면 "모델이 전부 노이즈라 판정" 과 "파싱이 깨짐" 이 구분되지 않아,
  // 위 사고가 6일간 만점으로 기록됐다.
  it('배열을 못 뽑으면 null (파싱 실패 신호)', () => {
    expect(parseGateResponse('not json', valid)).toBeNull();
    expect(parseGateResponse('```\n{}\n```', valid)).toBeNull();
  });

  it('validKeys 밖 changeKey 는 제거 — 빈 배열이지 null 이 아니다', () => {
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
    const result = parseGateResponse(raw, valid) ?? [];
    expect(result[0].suggestedAgentType).toBeUndefined();
  });
});
