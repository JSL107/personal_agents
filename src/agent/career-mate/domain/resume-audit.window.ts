import { ProfileAccomplishment } from './career-mate.type';

// 한 회차에 감사할 성과 개수 상한.
//
// 근거 — agent_run 원장(AUTOPILOT_RESUME_AUDIT_CRON) 실측:
//
//   날짜     상태       소요     성과 수
//   08-27    성공      259s      33
//   08-29    성공      182s      34
//   09-01    성공      222s      61
//   09-02    실패      601s      64
//   09-04    성공      225s      74
//   09-06    성공      245s      74
//   09-07    실패      602s      74   ← 같은 74 건인데 갈렸다
//   09-10    실패      602s      83
//
// 두 가지가 보인다. (1) 성공 회차 소요가 182~259s 로, 캡(300s)에 원래부터 아슬아슬했다.
// (2) 성과 수와 소요의 상관이 약하다 — 34 건도 259s 가 나오고 74 건도 219s 가 나온다.
// 즉 "85 건이라서 죽는다" 가 아니라 "원래 캡에 닿아 있었고, 74 건 부근부터 회차 변동이
// 캡을 상시 넘기기 시작했다" 가 정확하다. 상한을 두는 목적은 평균을 낮추는 것이 아니라
// 분산을 캡 아래로 내리는 것이다.
//
// 값을 30 으로 잡은 근거는 두 가지다.
//
// (1) 관측된 가장 안정적인 구간(34 건)도 최대 259s 로 캡의 86% 를 썼다. 그 아래로 내려야
//     회차 변동을 흡수할 여유가 생긴다. 40 으로 두면 34 건보다 크므로 같은 위험이 남는다.
// (2) 85 건 기준 40 은 40/40/5 로 쪼개져 마지막 회차가 5 건짜리 빈 회차가 되는데, 30 은
//     30/30/25 로 나뉘어 회차당 부하가 고르다. 구간 수(3)는 둘이 같아 순환 주기 손해가 없다.
//
// 입력뿐 아니라 출력(items 배열)이 함께 줄어드는 것이 핵심이다 — 성과 1 건마다 판정·인용·
// 재작성이 따라붙어 출력 길이가 성과 수에 비례하고, 입력만 줄이면 이 시간은 그대로 남는다.
export const RESUME_AUDIT_WINDOW_SIZE = 30;

export interface AuditWindow {
  // 이번 회차에 모델에게 보여줄 성과.
  selected: ProfileAccomplishment[];
  // 이번 회차 범위 밖이라 보여주지 않은 성과 제목. 가드가 UNJUDGED 를 채울 때 "모델이
  // 빼먹은 것" 과 구분하는 데 쓴다 — 둘을 같은 문구로 묶으면 모델 계약 위반이 정상 동작에
  // 섞여 보이지 않게 된다.
  outOfWindowTitles: string[];
  // 프롬프트·결과에 적을 범위 표기. 전량을 본 회차는 null 이다(표기 자체를 붙이지 않는다 —
  // 붙이면 "일부만 봤다" 는 인상이 잘못 생긴다).
  label: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 'YYYY-MM-DD' 를 epoch 기준 일수로. 파싱 실패는 0 으로 떨어뜨려 창을 맨 앞에 고정한다 —
// 회차를 통째로 잃느니 같은 구간을 반복해서라도 감사가 도는 쪽을 택한다.
const toDayIndex = (todayKst: string): number => {
  const parsed = Date.parse(`${todayKst}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.floor(parsed / MS_PER_DAY);
};

// 성과가 상한을 넘으면 날짜로 창을 굴려 며칠에 걸쳐 전량을 훑는다.
//
// 창을 "최근 N 건" 으로 고정하지 않는 이유: 이력서 감사는 오래된 성과일수록 WEAK 일 확률이
// 높은데, 고정하면 그 구간이 영영 판정되지 않는다. 반대로 "오래된 N 건" 으로 고정하면 새
// 성과가 안 보인다. 날짜 시드 순환은 상태를 새로 저장하지 않고 두 문제를 함께 피한다 —
// 85 건이면 사흘이면 한 바퀴다.
//
// 창은 배열 인덱스로 자르므로 `accomplishments` 의 순서가 바뀌면 같은 날짜라도 다른 성과가
// 뽑힌다. 한 회차 안에서는 한 번만 읽어 회차 내 일관성은 유지되고, 며칠 단위 커버리지에도
// 영향이 미미해 그대로 둔다(순서를 고정하려면 정렬 기준을 새로 정해야 한다).
export const selectAuditWindow = ({
  accomplishments,
  todayKst,
  windowSize = RESUME_AUDIT_WINDOW_SIZE,
}: {
  accomplishments: ProfileAccomplishment[];
  todayKst: string;
  windowSize?: number;
}): AuditWindow => {
  const total = accomplishments.length;
  // 상한 이하면 종전과 완전히 같게 동작한다(회귀 0). windowSize 가 0 이하로 잘못 들어온
  // 경우도 여기로 떨어뜨려 전량을 본다 — 나눗셈이 0 이 되어 창이 비는 것보다 낫다.
  if (windowSize <= 0 || total <= windowSize) {
    return { selected: accomplishments, outOfWindowTitles: [], label: null };
  }

  const windowCount = Math.ceil(total / windowSize);
  const windowIndex =
    ((toDayIndex(todayKst) % windowCount) + windowCount) % windowCount;
  const start = windowIndex * windowSize;
  const selected = accomplishments.slice(start, start + windowSize);
  const selectedTitles = new Set(selected.map((item) => item.title));

  return {
    selected,
    outOfWindowTitles: accomplishments
      .filter((item) => !selectedTitles.has(item.title))
      .map((item) => item.title),
    label: `${start + 1}~${start + selected.length}번째 / 전체 ${total}건`,
  };
};
