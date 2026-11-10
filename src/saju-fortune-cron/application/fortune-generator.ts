import { Injectable, Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  countUnremovableViolations,
  findFortuneViolations,
  FortuneViolation,
} from '../domain/saju-fortune-render';

// 응답 하나의 위반 — 종류 목록과 코드가 못 지우는 위반 수.
export interface FortuneInspection {
  kinds: FortuneViolation[];
  unremovable: number;
}

export interface GuardedRequest<T> {
  prompt: string;
  parse: (text: string) => T;
  inspect: (result: T) => FortuneInspection;
  slackUserId: string;
}

export const inspectBody = (body: string): FortuneInspection => {
  const kinds = findFortuneViolations(body);
  const inspection: FortuneInspection = {
    kinds,
    unremovable: countUnremovableViolations(kinds),
  };
  return inspection;
};

// 아침 운세·추가 메시지가 함께 쓰는 LLM 호출과 위반 재생성.
// LLM 은 provider 선택만을 위해 PM 을 빌린다(fact-answer 와 같은 방식) — 새 AgentType 을 만들면
// 슬래시·재실행·응답코드 체크리스트가 따라오는데 이 기능은 원장(agent_run)에 남길 일이 아니다.
@Injectable()
export class FortuneGenerator {
  private readonly logger = new Logger(FortuneGenerator.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  // 한자·명리 용어·AI 가 쓴 별·행운 숫자는 프롬프트 지시라 코드가 다시 본다. 걸리면 한 번만 다시 만들고,
  // 둘 다 걸리면 코드가 못 지우는 위반(한자·용어)이 적은 쪽(같으면 두 번째)을 보낸다 — 그날 운세가 아예 안 가는 것보다 낫다.
  async generateWithRetry<T>({
    prompt,
    parse,
    inspect,
    slackUserId,
  }: GuardedRequest<T>): Promise<T> {
    const first = parse(await this.complete(prompt));
    const firstInspection = inspect(first);
    if (firstInspection.kinds.length === 0) {
      return first;
    }
    const second = parse(await this.complete(prompt));
    const secondInspection = inspect(second);
    const prefersSecond =
      secondInspection.unremovable <= firstInspection.unremovable;
    const chosen = prefersSecond ? second : first;
    const remaining = prefersSecond ? secondInspection : firstInspection;
    if (remaining.kinds.length > 0) {
      this.logger.warn(
        `Saju Fortune 위반 응답(${remaining.kinds.join(',')}) — 재생성 후에도 남아 그대로 발송 (${slackUserId})`,
      );
    }
    return chosen;
  }

  private async complete(prompt: string): Promise<string> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: { prompt },
      noContractPreamble: true,
    });
    return completion.text;
  }
}
