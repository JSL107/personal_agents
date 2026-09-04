import {
  appendBlockReasonGuidance,
  BLOCK_REASON_PHRASES,
  classifyBlockReason,
} from './block-reason';

// 아래 문구는 전부 레포 실측값이다 — 지어낸 표본으로 매칭을 검증하면 실제 문구가 바뀌어도
// 초록이 유지된다(사전이 노리는 실패 경로를 못 지킨다).
const QUOTA_MESSAGE =
  '모델 호출 실패 (codex, 42s 소요). ChatGPT(codex) 사용량 한도 초과 — 2026-09-04 04:00 KST 에 리셋됩니다. 잠시 후 다시 시도해주세요.';
const GITHUB_INTEGRATION_MESSAGE =
  'GITHUB_TOKEN 이 .env 에 설정되지 않아 GitHub API 를 호출할 수 없습니다.';
const NOTION_INTEGRATION_MESSAGE =
  'NOTION_TOKEN 이 .env 에 설정되지 않았습니다 (.env 확인).';
const PREREQUISITE_MESSAGE =
  '직전 PM run 이 없습니다. `/today` 먼저 실행해 plan 을 만든 뒤 다시 시도해주세요.';

describe('classifyBlockReason', () => {
  it('실측 문구 3부류를 각각 알아본다', () => {
    expect(classifyBlockReason(QUOTA_MESSAGE)).toBe('QUOTA');
    expect(classifyBlockReason(GITHUB_INTEGRATION_MESSAGE)).toBe('INTEGRATION');
    expect(classifyBlockReason(NOTION_INTEGRATION_MESSAGE)).toBe('INTEGRATION');
    expect(classifyBlockReason(PREREQUISITE_MESSAGE)).toBe('PREREQUISITE');
  });

  it('모르는 실패는 아는 척하지 않는다', () => {
    expect(classifyBlockReason('PR diff 파싱에 실패했습니다.')).toBeNull();
  });
});

describe('appendBlockReasonGuidance', () => {
  it('미연동 문구에는 선언과 해결 행동을 둘 다 채운다', () => {
    const filled = appendBlockReasonGuidance(GITHUB_INTEGRATION_MESSAGE);

    expect(filled).toContain(GITHUB_INTEGRATION_MESSAGE);
    expect(filled).toContain(BLOCK_REASON_PHRASES.INTEGRATION.noFabrication);
    expect(filled).toContain(BLOCK_REASON_PHRASES.INTEGRATION.recovery);
  });

  it('이미 행동을 싣고 있으면 선언만 채운다 — 같은 말을 두 번 하지 않는다', () => {
    // 쿼터 문구는 리셋 시각 + "잠시 후 다시 시도", 선행 부재 문구는 "먼저 실행" 을 이미 담고 있다.
    const quota = appendBlockReasonGuidance(QUOTA_MESSAGE);
    const prerequisite = appendBlockReasonGuidance(PREREQUISITE_MESSAGE);

    expect(quota).toContain(BLOCK_REASON_PHRASES.QUOTA.noFabrication);
    expect(quota).not.toContain(BLOCK_REASON_PHRASES.QUOTA.recovery);
    expect(prerequisite).toContain(
      BLOCK_REASON_PHRASES.PREREQUISITE.noFabrication,
    );
    expect(prerequisite).not.toContain(
      BLOCK_REASON_PHRASES.PREREQUISITE.recovery,
    );
  });

  it('모르는 실패는 원문 그대로 둔다', () => {
    const reason = 'PR diff 파싱에 실패했습니다.';

    expect(appendBlockReasonGuidance(reason)).toBe(reason);
  });

  it('두 번 적용해도 문구가 늘지 않는다', () => {
    const once = appendBlockReasonGuidance(GITHUB_INTEGRATION_MESSAGE);

    expect(appendBlockReasonGuidance(once)).toBe(once);
  });
});
