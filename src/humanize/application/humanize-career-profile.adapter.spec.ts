import { CareerProfileData } from '../../agent/career-mate/domain/career-mate.type';
import { HumanizeService } from './humanize.service';
import { humanizeCareerProfile } from './humanize-career-profile.adapter';

const baseProfile = (): CareerProfileData => ({
  summary: '원본 요약',
  skills: [
    {
      name: 'TypeScript',
      category: 'LANGUAGE',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }],
    },
  ],
  accomplishments: [
    {
      title: '원본 타이틀',
      bullet: '원본 불릿',
      star: { situation: 's', task: 't', action: 'a', result: 'r' },
      techTags: ['TypeScript'],
      evidence: [
        { repo: 'o/r', pr: 1, url: 'https://x/1', mergedAt: '2026-01-01' },
      ],
    },
  ],
  meta: { githubLogin: 'octo', windowStart: '2026-01-01', prCount: 1 },
});

describe('humanizeCareerProfile', () => {
  it('서술 필드(summary/title/bullet/star)를 윤문하고 skills·evidence·techTags·meta 는 보존한다', async () => {
    const humanizer = {
      humanize: jest.fn(async (fields: Record<string, string>) => {
        const out: Record<string, string> = {};
        for (const key of Object.keys(fields)) {
          out[key] = `다듬:${fields[key]}`;
        }
        return out;
      }),
    } as unknown as HumanizeService;

    const result = await humanizeCareerProfile(baseProfile(), humanizer);

    expect(result.summary).toBe('다듬:원본 요약');
    expect(result.accomplishments[0].title).toBe('다듬:원본 타이틀');
    expect(result.accomplishments[0].bullet).toBe('다듬:원본 불릿');
    expect(result.accomplishments[0].star).toEqual({
      situation: '다듬:s',
      task: '다듬:t',
      action: '다듬:a',
      result: '다듬:r',
    });
    // 보존 대상
    expect(result.skills).toEqual(baseProfile().skills);
    expect(result.accomplishments[0].evidence).toEqual(
      baseProfile().accomplishments[0].evidence,
    );
    expect(result.accomplishments[0].techTags).toEqual(['TypeScript']);
    expect(result.meta).toEqual(baseProfile().meta);
  });

  it('humanizer 가 입력을 그대로 반환하면(비활성/실패) 프로필도 원본과 동일하다', async () => {
    const humanizer = {
      humanize: jest.fn(async (fields: Record<string, string>) => fields),
    } as unknown as HumanizeService;

    const profile = baseProfile();
    const result = await humanizeCareerProfile(profile, humanizer);

    expect(result).toEqual(profile);
  });

  it('accomplishments 가 비어도 summary 만 윤문한다', async () => {
    const humanizer = {
      humanize: jest.fn(async () => ({ summary: '다듬은 요약' })),
    } as unknown as HumanizeService;

    const profile = { ...baseProfile(), accomplishments: [] };
    const result = await humanizeCareerProfile(profile, humanizer);

    expect(result.summary).toBe('다듬은 요약');
    expect(result.accomplishments).toEqual([]);
  });

  it('humanizer 가 일부 키를 누락한 맵을 반환해도 누락분은 원본으로 채운다', async () => {
    const humanizer = {
      // summary 만 다듬고 accomplishment 키는 전부 누락한 비정상 응답
      humanize: jest.fn(async () => ({ summary: '다듬은 요약' })),
    } as unknown as HumanizeService;

    const result = await humanizeCareerProfile(baseProfile(), humanizer);

    expect(result.summary).toBe('다듬은 요약');
    expect(result.accomplishments[0].title).toBe('원본 타이틀');
    expect(result.accomplishments[0].bullet).toBe('원본 불릿');
    expect(result.accomplishments[0].star).toEqual({
      situation: 's',
      task: 't',
      action: 'a',
      result: 'r',
    });
  });
});
