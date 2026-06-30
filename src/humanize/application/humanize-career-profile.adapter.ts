import { CareerProfileData } from '../../agent/career-mate/domain/career-mate.type';
import { HumanizeService } from './humanize.service';

// CareerProfileData 의 서술 필드만 윤문한다 — summary + 각 accomplishment 의 title·bullet·star 4필드.
// skills(name/category/proficiency/evidence)·evidence·techTags·meta·수치·고유명사·코드 식별자는
// 윤문 대상이 아니다(HUMANIZE_SYSTEM_PROMPT 가 값 안의 고유명사/숫자/키 불변 규칙을 강제하고,
// 아래 재조립도 이 필드들을 원본 그대로 둔다). humanizer.humanize 가 비활성/실패 시 입력을 그대로
// 돌려주므로(best-effort), 그 경우 프로필도 원본과 동일하게 재조립된다.
export const humanizeCareerProfile = async (
  profile: CareerProfileData,
  humanizer: HumanizeService,
): Promise<CareerProfileData> => {
  const fields: Record<string, string> = { summary: profile.summary };
  profile.accomplishments.forEach((accomplishment, index) => {
    fields[`acc.${index}.title`] = accomplishment.title;
    fields[`acc.${index}.bullet`] = accomplishment.bullet;
    fields[`acc.${index}.situation`] = accomplishment.star.situation;
    fields[`acc.${index}.task`] = accomplishment.star.task;
    fields[`acc.${index}.action`] = accomplishment.star.action;
    fields[`acc.${index}.result`] = accomplishment.star.result;
  });

  const humanized = await humanizer.humanize(fields);

  // 역참조는 `?? 원본` 으로 방어한다 — HumanizeService 가 모든 입력 키를 보존 반환하므로
  // 현재는 항상 값이 있지만, 그 내부 구현에 결합되지 않도록 누락 시 원본으로 폴백한다.
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
