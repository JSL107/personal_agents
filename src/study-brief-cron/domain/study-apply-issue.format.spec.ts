import { ApplicabilityJudgement } from './study-applicability.type';
import {
  buildStudyApplyIssue,
  buildStudyApplyPreviewText,
  neutralizeForGithub,
} from './study-apply-issue.format';

const judgement: ApplicabilityJudgement = {
  verdict: 'APPLY',
  rawVerdict: 'APPLY',
  reason: '폴백 호출이 사용자 설정을 읽는다',
  citations: [
    {
      filePath: 'src/model-router/infrastructure/claude-cli.provider.ts',
      startLine: 91,
      endLine: 102,
      name: 'buildClaudeArgs',
      why: '@team 확인 [여기](https://evil.example)',
    },
  ],
  droppedCitations: [],
  downgradeReason: null,
  proposal: {
    title: '@org/team 즉시 반영 ![x](https://img.example/a.png)',
    problem: 'https://evil.example/patch 참고',
    change: '`--setting-sources` 를 준다',
    verify: '<!channel> 로 알린다',
  },
  candidateCount: 3,
};

describe('neutralizeForGithub', () => {
  it('멘션을 끊고 링크·이미지를 평문 URL 로 바꾼다', () => {
    const result = neutralizeForGithub(
      '@team [여기](https://e.example) ![i](https://i.example) https://b.example',
      500,
    );
    expect(result).toContain('@​team');
    expect(result).toContain('여기 (`https://e.example`)');
    expect(result).toContain('i (`https://i.example`)');
    expect(result).toContain('`https://b.example`');
    expect(result).not.toMatch(/\]\(/);
  });

  it('길이 상한을 지킨다', () => {
    expect(neutralizeForGithub('a'.repeat(300), 200)).toHaveLength(200);
  });
});

describe('buildStudyApplyIssue', () => {
  it('모델 텍스트는 무력화하고 인용은 파일:라인으로 싣는다', () => {
    const { title, body } = buildStudyApplyIssue({
      topic: 'Claude Code Hooks',
      notionUrl: 'https://notion.so/page',
      judgement,
    });
    expect(title.startsWith('[오늘의 공부] ')).toBe(true);
    expect(title).toContain('@​org/team');
    expect(title.length).toBeLessThanOrEqual(200);
    expect(body).toContain(
      '`src/model-router/infrastructure/claude-cli.provider.ts:91-102`',
    );
    expect(body).toContain('`https://evil.example/patch`');
    expect(body).not.toContain('](https://evil.example)');
    expect(body).toContain('https://notion.so/page');
    expect(body.length).toBeLessThanOrEqual(8000);
  });
});

describe('buildStudyApplyPreviewText', () => {
  it('Slack 멘션·브로드캐스트·링크 문법을 escape 한다', () => {
    const text = buildStudyApplyPreviewText({
      topic: '<!here> 주제',
      judgement,
      repo: 'JSL107/personal_agents',
    });
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<!here>');
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).toContain('JSL107/personal_agents');
  });
});
