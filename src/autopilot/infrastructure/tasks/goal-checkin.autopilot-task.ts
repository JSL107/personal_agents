import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  GOAL_QUESTION_REPOSITORY_PORT,
  GOAL_QUESTION_TTL_MS,
  GoalQuestionRepositoryPort,
} from '../../../agent/po-shadow/domain/port/goal-question.repository.port';
import {
  PRODUCT_GOAL_REPOSITORY_PORT,
  ProductGoalRepositoryPort,
} from '../../../agent/po-shadow/domain/port/product-goal.repository.port';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class GoalCheckinAutopilotTask implements AutopilotTask {
  readonly id = 'goal-checkin';
  private readonly logger = new Logger(GoalCheckinAutopilotTask.name);

  constructor(
    @Inject(PRODUCT_GOAL_REPOSITORY_PORT)
    private readonly productGoalRepository: ProductGoalRepositoryPort,
    @Inject(GOAL_QUESTION_REPOSITORY_PORT)
    private readonly goalQuestionRepository: GoalQuestionRepositoryPort,
  ) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const activeGoals =
      await this.productGoalRepository.findActive(ownerSlackUserId);
    if (activeGoals.length > 0) {
      return { skip: true };
    }

    const now = new Date();
    const openQuestion = await this.goalQuestionRepository.findOpen({
      slackUserId: ownerSlackUserId,
      now,
    });
    if (openQuestion) {
      return { skip: true };
    }

    return {
      skip: false,
      summaryText:
        '🧭 요즘 머릿속에 있는 목표가 있어요? 크기 상관없이 대충 말해 주세요. 제가 정리해서 보여 드릴게요.',
      onDelivered: async () => {
        try {
          await this.goalQuestionRepository.create({
            slackUserId: ownerSlackUserId,
            expiresAt: new Date(now.getTime() + GOAL_QUESTION_TTL_MS),
          });
        } catch (error) {
          this.logger.error('목표 질문 발송 후 표지 생성 실패', error);
          throw error;
        }
      },
    };
  }
}
