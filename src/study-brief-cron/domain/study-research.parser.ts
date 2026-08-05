import { DomainStatus } from '../../common/exception/domain-status.enum';
import { StudyBriefException } from './study-brief.exception';
import { StudyBriefErrorCode } from './study-brief-error-code.enum';

export type StudyResearchKind = 'CONCEPT' | 'TOOL';

export interface StudyResearchResult {
  kind: StudyResearchKind;
  topic: string;
  sourceUrls: string[];
  reportMd: string;
}

export interface StudyResearchSkipped {
  skippedReason: string;
}

export const parseStudyResearch = (
  raw: string,
): StudyResearchResult | StudyResearchSkipped => {
  const cleaned = stripCodeFence(raw.trim());
  const lines = cleaned.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    /^(?:KIND|NO_TOPIC):/.test(line.trim()),
  );
  if (startIndex < 0) {
    return invalidResearch('KIND 또는 NO_TOPIC 시작 줄이 없습니다.');
  }

  const relevantLines = lines.slice(startIndex);
  const firstLine = relevantLines[0].trim();
  if (firstLine.startsWith('NO_TOPIC:')) {
    const skippedReason = firstLine.slice('NO_TOPIC:'.length).trim();
    if (skippedReason.length === 0) {
      return invalidResearch('NO_TOPIC 사유가 비어 있습니다.');
    }
    return { skippedReason };
  }

  const kindValue = firstLine.slice('KIND:'.length).trim();
  if (kindValue !== 'CONCEPT' && kindValue !== 'TOOL') {
    return invalidResearch(
      `KIND 값이 CONCEPT 또는 TOOL이 아닙니다: ${kindValue || '(공백)'}`,
    );
  }

  const separatorIndex = relevantLines.findIndex(
    (line) => line.trim() === '---',
  );
  if (separatorIndex < 0) {
    return invalidResearch('조사 본문 앞 --- 구분선이 없습니다.');
  }

  const headerLines = relevantLines.slice(1, separatorIndex);
  const topicLine = headerLines.find((line) =>
    line.trim().startsWith('TOPIC:'),
  );
  const topic = topicLine?.trim().slice('TOPIC:'.length).trim() ?? '';
  if (topic.length === 0) {
    return invalidResearch('TOPIC 필드가 없거나 공백입니다.');
  }

  const sourceLine = headerLines.find((line) =>
    line.trim().startsWith('SOURCES:'),
  );
  const sourceUrls = parseSourceUrls(sourceLine);
  const reportMd = relevantLines
    .slice(separatorIndex + 1)
    .join('\n')
    .trim();
  if (reportMd.length === 0) {
    return invalidResearch('--- 구분선 뒤 조사 본문이 비어 있습니다.');
  }

  return { kind: kindValue, topic, sourceUrls, reportMd };
};

const parseSourceUrls = (sourceLine: string | undefined): string[] => {
  if (!sourceLine) {
    return [];
  }
  const rawSources = sourceLine.trim().slice('SOURCES:'.length).trim();
  return rawSources
    .split(/[,\s]+/)
    .map((source) => source.trim())
    .filter((source) => source.startsWith('http'));
};

const stripCodeFence = (text: string): string =>
  text
    .replace(/^```(?:[a-z0-9_-]+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const invalidResearch = (message: string): never => {
  throw new StudyBriefException({
    code: StudyBriefErrorCode.INVALID_RESEARCH_OUTPUT,
    message: `Hermes 조사 출력 거부 — ${message}`,
    status: DomainStatus.BAD_GATEWAY,
  });
};
