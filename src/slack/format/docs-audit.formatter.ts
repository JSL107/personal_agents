import { DocsAuditResult } from '../../docs-audit/domain/port/docs-audit.port';

// LLM/명령 출력에 mrkdwn 제어문자가 섞일 수 있어 백틱 코드블록으로 감싼다(escape 단순화).
export function formatDocsAudit(
  result: DocsAuditResult,
  firedAtKst: string,
): string {
  const lines: string[] = [];
  if (!result.deterministic.inSync) {
    lines.push(
      '*📄 문서 드리프트(결정론)* — `pnpm docs:sync` 후 커밋하면 해결:',
    );
    for (const detail of result.deterministic.details) {
      lines.push(`> \`${detail}\``);
    }
  }
  if (result.proposals.length > 0) {
    lines.push(`*🤖 문서 의미 드리프트 제안* (${firedAtKst}):`);
    for (const proposal of result.proposals) {
      const mark = proposal.confirmed ? '✅ 검증됨' : '⚠️ 미확정';
      lines.push(
        `> *${proposal.filePath}* (${mark}, score ${proposal.score})\n> ${proposal.rationale}`,
      );
    }
  }
  return lines.join('\n');
}
