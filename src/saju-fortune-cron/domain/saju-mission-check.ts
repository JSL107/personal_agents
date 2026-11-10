import {
  MissionDay,
  MissionResult,
} from './port/saju-fortune-day.repository.port';

// 저녁 미션 확인 메시지가 보여 주는 값 — 저장된 답 기준이다(누른 버튼이 아니라).
export interface MissionCheckView {
  fortuneDate: string;
  missionText: string;
  result?: MissionResult;
  // 그날이 속한 월~일의 완료 수.
  weekDone: number;
}

// 아침 운세를 받은 지 이만큼 안 됐으면 묻지 않는다 — 아침을 늦게 받는 사람에게 곧바로 묻지 않게.
export const MISSION_CHECK_MIN_GAP_MS = 3 * 60 * 60 * 1000;

interface MissionCheckCandidate {
  day: MissionDay;
  nowMs: number;
}

// 그날 운세가 나간 사람(행 있음)에게 저녁에 미션을 물어볼지: 아직 답이 없고, 아침에서 충분히 지났을 때만.
export const isMissionCheckDue = ({
  day,
  nowMs,
}: MissionCheckCandidate): boolean => {
  if (day.missionResult) {
    return false;
  }
  const sinceMorningMs = nowMs - day.createdAt.getTime();
  const due = sinceMorningMs >= MISSION_CHECK_MIN_GAP_MS;
  return due;
};
