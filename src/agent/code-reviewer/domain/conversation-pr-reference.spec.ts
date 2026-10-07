import { AgentType } from '../../../model-router/domain/model-router.type';
import { ConversationTurn } from '../../../router/domain/conversation-memory.type';
import { resolvePrReferenceFromConversation } from './conversation-pr-reference';
import { findPrReferences } from './pr-reference.parser';

const turn = (
  role: 'user' | 'assistant',
  text: string,
  agentType: AgentType | null,
): ConversationTurn => ({
  role,
  text,
  agentType,
  agentRunId: null,
  timestampMs: 0,
});

const PR_282_LINK =
  '<https://github.com/schoolbell-e/sbe-survey-v5/pull/282|github.com/schoolbell-e/sbe-survey-v5/pull/282>';

describe('findPrReferences', () => {
  it('URL·shorthand·Slack 링크를 나온 순서대로, 같은 PR 은 한 번만 찾는다', () => {
    expect(
      findPrReferences(
        `${PR_282_LINK} 랑 JSL107/personal_agents#741, 다시 schoolbell-e/sbe-survey-v5#282`,
      ),
    ).toEqual([
      { repo: 'schoolbell-e/sbe-survey-v5', number: 282 },
      { repo: 'JSL107/personal_agents', number: 741 },
    ]);
  });

  it('참조가 없으면 빈 배열', () => {
    expect(findPrReferences('게시까지 진행해줘.')).toEqual([]);
  });
});

describe('resolvePrReferenceFromConversation', () => {
  it('원문에 참조가 있으면 원문을 쓴다', () => {
    expect(
      resolvePrReferenceFromConversation(`${PR_282_LINK} 리뷰해줘`, [
        turn(
          'user',
          'JSL107/personal_agents#741 리뷰',
          AgentType.CODE_REVIEWER,
        ),
      ]),
    ).toEqual({ kind: 'FROM_TEXT' });
  });

  it('2026-08-27 — 링크 없는 "게시까지 진행해줘." 는 직전 리뷰 턴의 PR 을 잇는다', () => {
    expect(
      resolvePrReferenceFromConversation('게시까지 진행해줘.', [
        turn(
          'user',
          `${PR_282_LINK} / 이거 리뷰 가능?`,
          AgentType.CODE_REVIEWER,
        ),
        turn(
          'assistant',
          `*PR 리뷰 — ${PR_282_LINK}* 위험도: HIGH`,
          AgentType.CODE_REVIEWER,
        ),
      ]),
    ).toEqual({ kind: 'INHERITED', prRef: 'schoolbell-e/sbe-survey-v5#282' });
  });

  it('실패한 턴(agentType null)이 끼어 있어도 앞선 리뷰 턴에서 잇는다', () => {
    expect(
      resolvePrReferenceFromConversation('리뷰를 게시하라고', [
        turn('user', `${PR_282_LINK} 이거 리뷰 가능?`, AgentType.CODE_REVIEWER),
        turn('user', '게시까지 진행해줘.', null),
      ]),
    ).toEqual({ kind: 'INHERITED', prRef: 'schoolbell-e/sbe-survey-v5#282' });
  });

  it('다른 워커 턴의 PR 은 쓰지 않는다 — 게시 기본값이 켜져 있어 엉뚱한 PR 에 코멘트가 달린다', () => {
    expect(
      resolvePrReferenceFromConversation('게시해줘', [
        turn(
          'user',
          `${PR_282_LINK} 회고해서 이력서에 녹여줘`,
          AgentType.CAREER_MATE,
        ),
      ]),
    ).toEqual({ kind: 'NONE' });
  });

  it('리뷰 턴에 서로 다른 PR 이 둘 이상이면 고르지 않는다', () => {
    expect(
      resolvePrReferenceFromConversation('게시해줘', [
        turn('user', `${PR_282_LINK} 리뷰`, AgentType.CODE_REVIEWER),
        turn(
          'user',
          'JSL107/personal_agents#741 리뷰',
          AgentType.CODE_REVIEWER,
        ),
      ]),
    ).toEqual({
      kind: 'AMBIGUOUS',
      candidates: [
        'schoolbell-e/sbe-survey-v5#282',
        'JSL107/personal_agents#741',
      ],
    });
  });

  it('대화 기억이 없으면 NONE', () => {
    expect(resolvePrReferenceFromConversation('게시해줘', undefined)).toEqual({
      kind: 'NONE',
    });
  });
});
