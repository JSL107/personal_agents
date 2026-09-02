import {
  CareerProfileData,
  ProfileAccomplishment,
} from '../../agent/career-mate/domain/career-mate.type';
import { evidenceKey } from '../../agent/career-mate/domain/evidence-key';
import { HumanizeService } from './humanize.service';

// 이전 프로필에서 같은 PR 의 성과를 찾기 위한 색인. evidence 가 없는 항목은 evidenceKey 가
// 빈 문자열이라 서로 다른 성과가 한 칸에 겹친다 — 남의 성과와 값을 대조해 엉뚱한 필드를
// 건너뛰게 되므로 아예 색인에서 뺀다(짝을 못 찾으면 그냥 전부 윤문한다).
const indexByEvidence = (
  accomplishments: ProfileAccomplishment[],
): Map<string, ProfileAccomplishment> => {
  const index = new Map<string, ProfileAccomplishment>();
  for (const item of accomplishments) {
    const key = evidenceKey(item);
    if (key.length > 0) {
      index.set(key, item);
    }
  }
  return index;
};

// CareerProfileData 의 서술 필드만 윤문한다 — summary + 각 accomplishment 의 title·bullet·star 4필드.
// skills(name/category/proficiency/evidence)·evidence·techTags·meta·수치·고유명사·코드 식별자는
// 윤문 대상이 아니다(HUMANIZE_SYSTEM_PROMPT 가 값 안의 고유명사/숫자/키 불변 규칙을 강제하고,
// 아래 재조립도 이 필드들을 원본 그대로 둔다). humanizer.humanize 가 비활성/실패 시 입력을 그대로
// 돌려주므로(best-effort), 그 경우 프로필도 원본과 동일하게 재조립된다.
export const humanizeCareerProfile = async (
  profile: CareerProfileData,
  humanizer: HumanizeService,
  // 직전에 저장된 프로필. 저장되는 값이 곧 윤문본이므로 "이전과 값이 같은 필드" 는
  // "이미 윤문된 필드" 다 — 넘기면 그 필드를 payload 에서 빼고 이번에 바뀐 것만 윤문한다.
  //
  // 빼지 않으면 REFLECT_PR 이 회차마다 누적 성과 전체를 다시 윤문한다. payload 가 성과 수에
  // 비례해 단조 증가하다 codex timeout(300s)을 넘기는 순간 윤문이 통째로 실패하는데, 실제로
  // 2026-09-02 성과 62건(373필드)에서 처음 초과해 3회 연속 실패했다(AgentRun #2090·#2095·#2100,
  // 각 602s = 300s 타임아웃 × 재시도 2회). 61건 시점에도 278s 로 마진이 7% 뿐이었다.
  //
  // 전체 재합성(BUILD_PROFILE)은 모델이 프로필을 통째로 새로 만들어 옛 값과 대조할 게 없으므로
  // 넘기지 않는다 — 그 경로는 종전대로 전량 윤문한다.
  previous?: CareerProfileData | null,
): Promise<CareerProfileData> => {
  const previousByEvidence = indexByEvidence(previous?.accomplishments ?? []);
  const fields: Record<string, string> = {};
  const putIfChanged = (
    key: string,
    value: string,
    humanizedBefore: string | undefined,
  ): void => {
    if (humanizedBefore !== value) {
      fields[key] = value;
    }
  };

  putIfChanged('summary', profile.summary, previous?.summary);
  profile.accomplishments.forEach((accomplishment, index) => {
    const before = previousByEvidence.get(evidenceKey(accomplishment));
    putIfChanged(`acc.${index}.title`, accomplishment.title, before?.title);
    putIfChanged(`acc.${index}.bullet`, accomplishment.bullet, before?.bullet);
    putIfChanged(
      `acc.${index}.situation`,
      accomplishment.star.situation,
      before?.star.situation,
    );
    putIfChanged(
      `acc.${index}.task`,
      accomplishment.star.task,
      before?.star.task,
    );
    putIfChanged(
      `acc.${index}.action`,
      accomplishment.star.action,
      before?.star.action,
    );
    putIfChanged(
      `acc.${index}.result`,
      accomplishment.star.result,
      before?.star.result,
    );
  });

  // 이력서 STAR 는 구체 상황·수치를 담는 자리라 길이 예산을 걸지 않는다. 압축을 걸면
  // 가장 먼저 깎이는 것이 그 구체성이고, 이력서에서는 그게 곧 내용이다.
  const humanized = await humanizer.humanize(fields, { longForm: true });

  // 역참조는 `?? 원본` 으로 방어한다 — 위에서 건너뛴 필드는 애초에 humanized 에 없고,
  // 그 자리는 원본(= 이전 회차에 윤문돼 저장된 값)이 그대로 들어온다.
  return {
    ...profile,
    summary: humanized.summary ?? profile.summary,
    accomplishments: profile.accomplishments.map((accomplishment, index) => ({
      ...accomplishment,
      title: humanized[`acc.${index}.title`] ?? accomplishment.title,
      bullet: humanized[`acc.${index}.bullet`] ?? accomplishment.bullet,
      star: {
        situation:
          humanized[`acc.${index}.situation`] ?? accomplishment.star.situation,
        task: humanized[`acc.${index}.task`] ?? accomplishment.star.task,
        action: humanized[`acc.${index}.action`] ?? accomplishment.star.action,
        result: humanized[`acc.${index}.result`] ?? accomplishment.star.result,
      },
    })),
  };
};
