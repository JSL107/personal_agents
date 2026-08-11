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
  // 드리프트 0건이면 빈 문자열 — 0건 하트비트는 호출자(docs-sync-audit task)가 만든다.
  // preview 경로가 이 반환값을 승인 카드 본문에 그대로 재사용하므로, 여기서 하트비트를
  // 돌려주면 "드리프트 없음" 과 "적용 미리보기" 가 한 카드에 함께 붙는다.
  return lines.join('\n');
}
