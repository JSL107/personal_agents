import { DomainStatus } from '../../common/exception/domain-status.enum';
import { StudyBriefException } from './study-brief.exception';
import { StudyBriefErrorCode } from './study-brief-error-code.enum';

export interface StudyDeepdiveDraft {
  title: string;
  tags: string[];
  bodyMd: string;
}

const MAX_TAGS = 5;
const TAG_MAX_LENGTH = 100;
const MIN_BODY_LENGTH = 800;

// Hermes 자유 텍스트 출력 파서. 출력 계약은 study-deepdive.prompt.ts 의 [출력 형식] 절.
// 형제 파서(study-research.parser.ts)와 같은 규약 — 헤더 줄 + `---` + 본문.
export const parseStudyDeepdive = (raw: string): StudyDeepdiveDraft => {
  const lines = raw.trim().split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    line.trim().startsWith('TITLE:'),
  );
  if (startIndex < 0) {
    throw invalidDeepdive('TITLE 시작 줄이 없습니다.');
  }

  const relevantLines = lines.slice(startIndex);
  const separatorIndex = relevantLines.findIndex(
    (line) => line.trim() === '---',
  );
  if (separatorIndex < 0) {
    throw invalidDeepdive('본문 앞 --- 구분선이 없습니다.');
  }

  const headerLines = relevantLines.slice(0, separatorIndex);
  const title = readHeaderValue(headerLines, 'TITLE:');
  if (title.length === 0) {
    throw invalidDeepdive('TITLE 값이 비어 있습니다.');
  }

  const bodyMd = stripWrappingFence(
    relevantLines.slice(separatorIndex + 1).join('\n'),
  ).trim();
  // 분량 계약은 4,000자 이상이지만, 여기서는 "글이 아닌 것"만 막는다. 모델이 계약보다
  // 짧게 쓰는 것과 한 문단만 뱉는 것은 다른 문제다 — 전자는 편집 단계가, 후자는 여기가 잡는다.
  if (bodyMd.length < MIN_BODY_LENGTH) {
    throw invalidDeepdive(
      `본문이 ${bodyMd.length}자로 너무 짧습니다(최소 ${MIN_BODY_LENGTH}자).`,
    );
  }

  return {
    title,
    tags: parseTags(readHeaderValue(headerLines, 'TAGS:')),
    bodyMd: normalizeHeadingLevels(bodyMd),
  };
};

// Notion 왕복은 헤딩 레벨을 한 단계 **올린다**: `## ` 는 heading_2 로 적재되고
// (markdown-to-blocks.ts 가 `##` 를 heading, `###` 를 subheading 으로 본다), 발행 라인이
// 되읽을 때 heading_2 는 `# ` 로 복원된다(blocks-to-markdown.ts). 그대로 두면 소제목마다
// h1 이 생긴다 — 실측에서 소제목 7개가 전부 `# ` 로 돌아왔다.
// 적재 전에 한 단계 내려 두면 왕복 후 `## ` 로 제자리에 온다.
//
// 코드블록 안은 건드리지 않는다. 셸·Python 예시의 `# 주석` 이 소제목으로 바뀌면 코드가 깨진다.
const normalizeHeadingLevels = (body: string): string => {
  let insideFence = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^```/.test(line.trim())) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) {
        return line;
      }
      return line.replace(/^#{1,3}(\s+)/, '###$1');
    })
    .join('\n');
};

const readHeaderValue = (headerLines: string[], prefix: string): string => {
  const found = headerLines.find((line) => line.trim().startsWith(prefix));
  return found?.trim().slice(prefix.length).trim() ?? '';
};

// Notion multi_select 옵션명은 쉼표를 포함할 수 없다 (evening-blog-publish-properties 와 같은 제약).
const parseTags = (rawTags: string): string[] => {
  const seen = new Set<string>();
  for (const candidate of rawTags.split(',')) {
    const tag = candidate.trim().slice(0, TAG_MAX_LENGTH);
    if (tag.length > 0) {
      seen.add(tag);
    }
  }
  return [...seen].slice(0, MAX_TAGS);
};

// 모델이 본문 전체를 코드펜스로 감싸는 경우가 있다. 그대로 두면 글 한 편이 Notion 코드블록
// 하나로 들어가므로 벗겨야 하지만, 앞뒤를 무조건 벗기면 본문이 코드블록으로 끝날 때 닫는 펜스가
// 사라져 이후 변환이 통째로 깨진다. 펜스 개수의 홀짝으로도 구분되지 않는다 — 감싼 경우도
// (열기 + 닫기 =) 짝수다.
//
// 그래서 "첫 줄 펜스와 마지막 줄 펜스가 서로 짝인지" 로 판정한다: 그 사이 펜스가 짝수면
// 안쪽이 스스로 닫혀 있다는 뜻이라, 바깥 두 줄이 한 쌍이다.
// 한계: 본문이 코드블록으로 시작하면서 코드블록으로 끝나면 감싼 것으로 오판한다. 프롬프트가
// 첫 절을 `## ` 소제목으로 시작하도록 지시하므로 그 형태는 계약 위반이고, 감싼 펜스를 놓치는
// 쪽(글 전체가 코드블록이 되는 것)이 더 큰 사고다.
const stripWrappingFence = (body: string): string => {
  const lines = body.trim().split(/\r?\n/);
  if (lines.length < 3) {
    return body.trim();
  }
  const isOpeningFence = /^```[a-z0-9_-]*$/i.test(lines[0].trim());
  const isClosingFence = lines[lines.length - 1].trim() === '```';
  if (!isOpeningFence || !isClosingFence) {
    return body.trim();
  }
  const innerFenceCount = lines
    .slice(1, -1)
    .filter((line) => /^```/.test(line.trim())).length;
  if (innerFenceCount % 2 !== 0) {
    return body.trim();
  }
  return lines.slice(1, -1).join('\n').trim();
};

const invalidDeepdive = (message: string): StudyBriefException =>
  new StudyBriefException({
    code: StudyBriefErrorCode.INVALID_DEEPDIVE_OUTPUT,
    message: `Hermes 딥다이브 출력 거부 — ${message}`,
    status: DomainStatus.BAD_GATEWAY,
  });
