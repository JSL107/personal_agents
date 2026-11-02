import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../model-router/model-router.module';
import { AnswerFortuneQuestionUsecase } from './application/answer-fortune-question.usecase';

// 운세 DM 스레드 대화 — SlackModule 이 import 한다. SajuFortuneCronModule 은 SlackModule 을
// import 하므로 그쪽에 두면 순환이 생겨 따로 뺐다.
@Module({
  imports: [ModelRouterModule],
  providers: [AnswerFortuneQuestionUsecase],
  exports: [AnswerFortuneQuestionUsecase],
})
export class SajuFortuneChatModule {}
