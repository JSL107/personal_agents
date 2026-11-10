import { Inject, Injectable } from '@nestjs/common';

import {
  MissionAnswer,
  SAJU_FORTUNE_DAY_REPOSITORY_PORT,
  SajuFortuneDayKey,
  SajuFortuneDayRepositoryPort,
} from '../domain/port/saju-fortune-day.repository.port';
import { weekPeriodOf } from '../domain/saju-fortune-period';
import { MissionCheckView } from '../domain/saju-mission-check';

// 저녁 미션 확인의 답 저장과 화면 값. 저장과 다시 읽기를 나눠 둔다 — 저장은 됐는데 읽기만 실패한 경우를
// 호출부가 "저장 실패"로 잘못 안내하지 않게.
@Injectable()
export class AnswerMissionUsecase {
  constructor(
    @Inject(SAJU_FORTUNE_DAY_REPOSITORY_PORT)
    private readonly fortuneDays: SajuFortuneDayRepositoryPort,
  ) {}

  // 마지막 답이 이긴다. false = 그날 행이 없다.
  answer(answer: MissionAnswer): Promise<boolean> {
    return this.fortuneDays.answerMission(answer);
  }

  async viewOf({
    slackUserId,
    fortuneDate,
  }: SajuFortuneDayKey): Promise<MissionCheckView | undefined> {
    const day = await this.fortuneDays.findMissionDay({
      slackUserId,
      fortuneDate,
    });
    if (!day) {
      return undefined;
    }
    const weekDone = await this.fortuneDays.countDone({
      slackUserId,
      period: weekPeriodOf({ date: fortuneDate }),
    });
    const view: MissionCheckView = {
      fortuneDate,
      missionText: day.missionText,
      result: day.missionResult,
      weekDone,
    };
    return view;
  }
}
