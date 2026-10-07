import { DispatchInput } from '../../router/domain/idaeri-router.port';

// 메뉴형 워커 파서에 직전 대화 몇 턴을 함께 준다 — "8일 기준이라면" 처럼 앞 턴을 받아야 뜻이 서는
// 말이 있다. 분류 대상은 [이번 메시지] 뿐이라는 것을 각 파서 프롬프트가 함께 밝힌다.
const PARSE_PRIOR_TURNS = 3;
const PARSE_PRIOR_TEXT_CAP = 200;

export const buildParsePromptWithContext = (
  todayIso: string,
  input: Pick<DispatchInput, 'text' | 'priorTurns'>,
): string => {
  const prior = (input.priorTurns ?? [])
    .slice(-PARSE_PRIOR_TURNS)
    .map(
      (turn) =>
        `[${turn.role === 'assistant' ? 'assistant' : 'user'}] ${turn.text.slice(0, PARSE_PRIOR_TEXT_CAP)}`,
    );
  return [
    `[오늘: ${todayIso}]`,
    ...(prior.length > 0 ? ['[이전 대화]', ...prior] : []),
    '[이번 메시지]',
    input.text ?? '',
  ].join('\n');
};
