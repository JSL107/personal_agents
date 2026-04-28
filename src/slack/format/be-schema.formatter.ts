import { SchemaProposal } from '../../agent/be-schema/domain/be-schema.type';

// /be-schema 응답 포매터.
// proposedModel 은 Slack 코드블록(```)으로 감싸 사용자가 schema.prisma 에 그대로 paste 할 수 있게 한다.
// 나머지 필드는 항목별 ` • ` 리스트.
export const formatSchemaProposal = (proposal: SchemaProposal): string => {
  const lines: string[] = [];
  lines.push(`*🛢️ Schema 제안 — ${proposal.request}*`);
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

  if (proposal.migrationStrategy.trim().length > 0) {
    lines.push('');
    lines.push('*마이그레이션 전략*');
    lines.push(proposal.migrationStrategy.trim());
  }

  if (proposal.reasoning.trim().length > 0) {
    lines.push('');
    lines.push(`_${proposal.reasoning.trim()}_`);
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
    lines.push(`• ${item}`);
  }
};
