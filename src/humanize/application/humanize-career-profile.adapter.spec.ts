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
  describe('previous(직전 프로필) 를 넘기면', () => {
    const accomplishmentAt = (
      pr: number,
    ): CareerProfileData['accomplishments'][number] => ({
      title: `타이틀${pr}`,
      bullet: `불릿${pr}`,
      star: {
        situation: `s${pr}`,
        task: `t${pr}`,
        action: `a${pr}`,
        result: `r${pr}`,
      },
      techTags: [],
      evidence: [
        {
          repo: 'o/r',
          pr,
          url: `https://x/${pr}`,
          mergedAt: '2026-01-01',
        },
      ],
    });

    const passthroughHumanizer = (): HumanizeService =>
      ({
        humanize: jest.fn(async (fields: Record<string, string>) => {
          const out: Record<string, string> = {};
          for (const key of Object.keys(fields)) {
            out[key] = `다듬:${fields[key]}`;
          }
          return out;
        }),
      }) as unknown as HumanizeService;

    it('값이 그대로인 성과는 윤문 payload 에서 빠져 누적분이 재윤문되지 않는다', async () => {
      const kept = Array.from({ length: 60 }, (_, order) =>
        accomplishmentAt(order + 1),
      );
      const previous: CareerProfileData = {
        ...baseProfile(),
        summary: '이미 다듬은 요약',
        accomplishments: kept,
      };
      // 새 PR 성과 1건만 맨 앞에 붙은 상태 (mergeAccomplishment 결과와 같은 모양)
      const merged: CareerProfileData = {
        ...previous,
        accomplishments: [accomplishmentAt(999), ...kept],
      };
      const humanizer = passthroughHumanizer();

      const result = await humanizeCareerProfile(merged, humanizer, previous);

      // payload 는 성과 61건이 아니라 새 성과 6필드만 — 성과 수에 비례해 커지지 않는다.
      const payload = (humanizer.humanize as jest.Mock).mock.calls[0][0];
      expect(Object.keys(payload).sort()).toEqual([
        'acc.0.action',
        'acc.0.bullet',
        'acc.0.result',
        'acc.0.situation',
        'acc.0.task',
        'acc.0.title',
      ]);
      // 새 성과는 윤문되고, 건너뛴 옛 성과는 저장된 값 그대로 남는다.
      expect(result.accomplishments[0].title).toBe('다듬:타이틀999');
      expect(result.accomplishments[1]).toEqual(kept[0]);
      expect(result.summary).toBe('이미 다듬은 요약');
    });

    it('같은 PR 이라도 값이 바뀐 필드는 다시 윤문한다', async () => {
      const previous: CareerProfileData = {
        ...baseProfile(),
        accomplishments: [accomplishmentAt(1)],
      };
      const rewritten = {
        ...accomplishmentAt(1),
        bullet: '새로 쓴 불릿',
      };
      const humanizer = passthroughHumanizer();

      const result = await humanizeCareerProfile(
        { ...previous, accomplishments: [rewritten] },
        humanizer,
        previous,
      );

      const payload = (humanizer.humanize as jest.Mock).mock.calls[0][0];
      expect(Object.keys(payload)).toEqual(['acc.0.bullet']);
      expect(result.accomplishments[0].bullet).toBe('다듬:새로 쓴 불릿');
      expect(result.accomplishments[0].title).toBe('타이틀1');
    });

    it('바뀐 필드가 하나도 없으면 payload 가 비고 프로필은 원본 그대로다', async () => {
      const previous: CareerProfileData = {
        ...baseProfile(),
        summary: '이미 다듬은 요약',
        accomplishments: [accomplishmentAt(1)],
      };
      const humanizer = passthroughHumanizer();

      // 같은 PR 을 다시 회고했는데 모델이 같은 문장을 돌려준 경우 — 모든 필드가 "이전과 같음" 이다.
      const result = await humanizeCareerProfile(previous, humanizer, previous);

      const payload = (humanizer.humanize as jest.Mock).mock.calls[0][0];
      expect(payload).toEqual({});
      // 빈 payload 에는 HumanizeService 가 모델을 부르지 않고 빈 맵을 돌려준다.
      // 그때도 `?? 원본` 역참조가 저장된 윤문본을 그대로 복원해야 한다.
      expect(result).toEqual(previous);
    });

    it('evidence 가 없어 짝을 못 찾는 성과는 건너뛰지 않고 전부 윤문한다', async () => {
      const orphan = { ...accomplishmentAt(1), evidence: [] };
      const previous: CareerProfileData = {
        ...baseProfile(),
        summary: '이미 다듬은 요약',
        accomplishments: [orphan],
      };
      const humanizer = passthroughHumanizer();

      await humanizeCareerProfile(previous, humanizer, previous);

      const payload = (humanizer.humanize as jest.Mock).mock.calls[0][0];
      expect(Object.keys(payload).sort()).toEqual([
        'acc.0.action',
        'acc.0.bullet',
        'acc.0.result',
        'acc.0.situation',
        'acc.0.task',
        'acc.0.title',
      ]);
    });
  });
});
