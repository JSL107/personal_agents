import { SchemaProposal } from '../../agent/be-schema/domain/be-schema.type';

// /be-schema 응답 포매터.
// proposedModel 은 Slack 코드블록(```)으로 감싸 사용자가 schema.prisma 에 그대로 paste 할 수 있게 한다.
// 나머지 free-text 필드는 LLM 출력 그대로 노출되므로 prompt-injected mrkdwn (@here, @channel,
// <user>, <url|display>) 으로 인한 메시지 위조를 막기 위해 escape 적용 (V3 mid-progress audit B4 M-2).
// 단 proposedModel 은 ```prisma fence 안이라 이미 mrkdwn 가 비활성화돼 별도 escape 불필요.
export const formatSchemaProposal = (proposal: SchemaProposal): string => {
  const lines: string[] = [];
  lines.push(`*🛢️ Schema 제안 — ${escapeSlackMrkdwn(proposal.request)}*`);
  lines.push('');

  if (proposal.proposedModel.trim().length > 0) {
    lines.push('*제안 모델 / 변경*');
    lines.push('```prisma');
    lines.push(proposal.proposedModel.trim());
    lines.push('```');
  }

  appendSection(lines, '영향 받는 모델 / 관계', proposal.affectedRelations);
  appendSection(lines, '필요한 인덱스 / 유니크', proposal.requiredIndexes);
  appendSection(lines, '컨벤션 점검', proposal.conventionChecks);
  appendSection(lines, '리스크', proposal.risks);
  // V3 단계 5 — Code Graph query 결과. @prisma/client 를 import 한 파일 surface.
  if (proposal.affectedFiles.length > 0) {
    appendAffectedFiles(lines, proposal.affectedFiles);
  }

  if (proposal.migrationStrategy.trim().length > 0) {
    lines.push('');
    lines.push('*마이그레이션 전략*');
    lines.push(escapeSlackMrkdwn(proposal.migrationStrategy.trim()));
  }

  if (proposal.reasoning.trim().length > 0) {
    lines.push('');
    lines.push(`_${escapeSlackMrkdwn(proposal.reasoning.trim())}_`);
  }

  return lines.join('\n');
};

const appendSection = (
  lines: string[],
  title: string,
  items: string[],
): void => {
  if (items.length === 0) {
    return;
  }
  lines.push('');
  lines.push(`*${title}*`);
  for (const item of items) {
    lines.push(`• ${escapeSlackMrkdwn(item)}`);
  }
};

// Slack mrkdwn 의 control 문자(<, >, &) 를 entity 로 escape 해 LLM 출력에 의한 메시지 위조를 차단.
// (Slack 공식 가이드: https://api.slack.com/reference/surfaces/formatting#escaping)
const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// affectedFiles 는 서버 주입 (코드 그래프 결과) 이라 escape 불필요하지만 일관성 위해 escape.
// 길이가 길어질 수 있어 head 10개만 노출 + 잔여 카운트.
const FILES_DISPLAY_LIMIT = 10;
const appendAffectedFiles = (lines: string[], files: string[]): void => {
  lines.push('');
  lines.push(`*영향 받는 파일 (\`@prisma/client\` 사용 — ${files.length}개)*`);
  const head = files.slice(0, FILES_DISPLAY_LIMIT);
  for (const file of head) {
    lines.push(`• \`${escapeSlackMrkdwn(file)}\``);
  }
  const remaining = files.length - head.length;
  if (remaining > 0) {
    lines.push(`_(${remaining}개 추가 생략)_`);
  }
};
