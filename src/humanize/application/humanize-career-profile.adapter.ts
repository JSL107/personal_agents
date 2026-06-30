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

  return {
    ...profile,
    summary: humanized.summary,
    accomplishments: profile.accomplishments.map((accomplishment, index) => ({
      ...accomplishment,
      title: humanized[`acc.${index}.title`],
      bullet: humanized[`acc.${index}.bullet`],
      star: {
        situation: humanized[`acc.${index}.situation`],
        task: humanized[`acc.${index}.task`],
        action: humanized[`acc.${index}.action`],
        result: humanized[`acc.${index}.result`],
      },
    })),
  };
};
