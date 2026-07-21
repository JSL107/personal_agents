import { Logger } from '@nestjs/common';
import { RespondFn } from '@slack/bolt';

import { AgentRunOutcome } from '../../agent-run/application/agent-run.service';
import { DomainException } from '../../common/exception/domain.exception';
import { FormattedReport } from '../format/formatted-report.type';
import { formatModelFooter } from '../format/model-footer.formatter';

// FormattedReport → summary + '\n\n' + detail 합본 문자열. string 은 그대로 통과.
const toSlackText = (formatted: FormattedReport | string): string => {
  if (typeof formatted === 'string') {
    return formatted;
  }
  return `${formatted.summary}\n\n${formatted.detail}`;
};

// 도메인 예외 message 는 그대로 노출, 그 외 (Prisma/네트워크/내부) 는 generic 으로 가린다.
// stack trace / Prisma 내부 메시지가 사용자에게 새는 걸 막는 1차 방어선.
export const toUserFacingErrorMessage = (error: unknown): string => {
  if (error instanceof DomainException) {
    return error.message;
  }
  return '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
};

// /sync-context, /quota 처럼 모델 호출 없는 명령용 — try/catch + log + ephemeral respond 만 묶음.
// AgentRunOutcome 푸터가 없으므로 format 결과를 그대로 노출한다.
export const runEphemeral = async <T>(args: {
  respond: RespondFn;
  logger: Logger;
  commandLabel: string;
  task: () => Promise<T>;
  format: (result: T) => string;
}): Promise<void> => {
  const { respond, logger, commandLabel, task, format } = args;
  try {
    const result = await task();
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: format(result),
    });
  } catch (error: unknown) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `${commandLabel} 실패: ${rawMessage}`,
      error instanceof Error ? error.stack : undefined,
    );
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: `이대리 ${commandLabel} 실패: ${toUserFacingErrorMessage(error)}`,
    });
  }
};

// /today, /worklog 등 AgentRunOutcome<T> 를 반환하는 모델 호출 명령용 — format 결과 끝에
// `_model: codex-cli · run #N_` 푸터 자동 부착 (PRO-3).
// format 은 string 또는 FormattedReport 를 반환 가능 — FormattedReport 는 summary+detail 합본으로 렌더.
//
// onOutcome — 실행 성공 후 부가 처리(재시도 계보 연결 등). 사용자 응답을 보낸 뒤 호출하며,
// 여기서 난 오류는 warn 으로만 남기고 삼킨다. 부가 관측성이 주 기능(결과 전달)을 막으면 안 되기 때문.
export const runAgentCommand = async <T>(args: {
  respond: RespondFn;
  logger: Logger;
  commandLabel: string;
  execute: () => Promise<AgentRunOutcome<T>>;
  format: (result: T) => FormattedReport | string;
  onOutcome?: (outcome: AgentRunOutcome<T>) => Promise<void>;
}): Promise<void> => {
  const { respond, logger, commandLabel, execute, format, onOutcome } = args;
  try {
    const outcome = await execute();
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: toSlackText(format(outcome.result)) + formatModelFooter(outcome),
    });
    if (onOutcome) {
      try {
        await onOutcome(outcome);
      } catch (error: unknown) {
        logger.warn(
          `${commandLabel} 실행 후처리 실패 (응답은 정상 전달됨): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error: unknown) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `${commandLabel} 실패: ${rawMessage}`,
      error instanceof Error ? error.stack : undefined,
    );
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: `이대리 ${commandLabel} 실패: ${toUserFacingErrorMessage(error)}`,
    });
  }
};
