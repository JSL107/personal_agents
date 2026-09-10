import {
  PoShadowRecoverySummary,
  PoShadowReport,
} from '../../agent/po-shadow/domain/po-shadow.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// 조회하지 못한 소스는 조용한 날에도, 지적이 있는 날에도 그대로 밝힌다. "이상 없음" 과
// "못 봤음" 이 같은 글자로 나가면 카드가 조용한 고장을 덮는다.
export const formatPoShadowReport = (report: PoShadowReport): string => {
  if (report.quiet) {
    return formatQuietReport(report);
  }

  const sections = [
    '*PO 검토*',
    `🎯 *먼저 이것부터* ${escapeSlackMrkdwn(report.headline)}`,
  ];

  if (report.findings.length > 0) {
    sections.push(formatFindings(report));
  } else if (report.factSummary.length > 0) {
    sections.push(formatEvidenceLines(report.factSummary));
  }

  const judgmentBlock = formatJudgments(report.judgments);
  if (judgmentBlock) {
    sections.push(judgmentBlock);
  }

  if (report.droppedFindingCount > 0) {
    sections.push(
      `_근거 없는 지적 ${report.droppedFindingCount}건은 제외했습니다._`,
    );
  }

  const recoveryBlock = formatRecoveryBlock(report.recoverySummary);
  if (recoveryBlock) {
    sections.push(recoveryBlock);
  }

  const degradedLine = formatDegradedLine(report.degradedSources);
  if (degradedLine) {
    sections.push(degradedLine);
  }

  return sections.join('\n\n');
};

// 사실표 밖 판단은 "추정" 을 달아 내보낸다 — 근거 없이 말해도 되지만 근거 없음을 실토한다.
const formatJudgments = (judgments: string[]): string | null => {
  if (judgments.length === 0) {
    return null;
  }
  return judgments
    .map((judgment) => `🤔 _추정_ ${escapeSlackMrkdwn(judgment)}`)
    .join('\n');
};

// 회수 결과는 factSummary 에 싣지 않는다 — 그 배열은 모델이 인용한 사실만 담으므로
// 슬롯을 안 쓰면 회수가 조용히 사라진다. quiet·비-quiet 공통으로 독립 블록에 낸다.
const formatRecoveryBlock = (
  summary: PoShadowRecoverySummary | null,
): string | null => {
  if (summary === null) {
    return null;
  }
  const comparable = summary.total - summary.uncomparable;
  const head =
    summary.uncomparable === 0
      ? `🔁 *지난 지적 ${comparable}건*`
      : `🔁 *지난 지적 ${comparable}건* (대조 불가 ${summary.uncomparable}건)`;

  const parts = [`머지 ${summary.merged}`];
  // 미해결에는 7일 미만이라 사실을 만들지 않은 키도 들어간다. 그 차이를 밝히지 않으면
  // 숫자와 근거 줄이 어긋나 보여 정상 동작과 진짜 고장이 화면에서 같아진다.
  const pendingCount = summary.unresolved - summary.unmovedFactCount;
  parts.push(
    pendingCount > 0
      ? `미해결 ${summary.unresolved} (그중 ${pendingCount}건은 지적 7일 미만)`
      : `미해결 ${summary.unresolved}`,
  );
  if (summary.abandoned > 0) {
    parts.push(`머지 없이 닫힘 ${summary.abandoned}`);
  }
  if (summary.unassigned > 0) {
    parts.push(`담당에서 빠짐 ${summary.unassigned}`);
  }

  // 대조군(지적하지 않은 항목의 이동률)은 아직 재지 않는다 — 맨 숫자를 비율처럼 읽지 않게 밝힌다.
  return `${head}\n  ${parts.join(' · ')}\n  _비교 대상 없음 — 지적하지 않은 항목의 이동률은 아직 재지 않습니다._`;
};

const formatDegradedLine = (degradedSources: string[]): string | null => {
  if (degradedSources.length === 0) {
    return null;
  }
  const escapedSources = degradedSources.map(escapeSlackMrkdwn).join(' · ');
  return `⚠️ _${escapedSources} 조회 실패 — 이 회차는 해당 근거 없이 판단했습니다._`;
};

const formatQuietReport = (report: PoShadowReport): string => {
  const escapedFacts = report.factSummary.map(escapeSlackMrkdwn);
  const headLine =
    escapedFacts.length === 0
      ? '✅ *PO 검토* — 계획대로 진행 중'
      : `✅ *PO 검토* — 계획대로 진행 중 (${escapedFacts.join(' · ')})`;
  const blocks = [headLine];
  const recoveryBlock = formatRecoveryBlock(report.recoverySummary);
  if (recoveryBlock) {
    blocks.push(recoveryBlock);
  }
  const degradedLine = formatDegradedLine(report.degradedSources);
  if (degradedLine) {
    blocks.push(degradedLine);
  }
  return blocks.join('\n\n');
};

const formatFindings = (report: PoShadowReport): string =>
  report.findings
    .map((finding, index) => {
      const point = escapeSlackMrkdwn(finding.point);
      const suggestion = escapeSlackMrkdwn(finding.suggestion);
      const findingLine = `• ${point} — ${suggestion}`;
      const fact = report.factSummary[index];
      if (fact === undefined) {
        return findingLine;
      }
      return `${findingLine}\n  ↳ 근거: ${escapeSlackMrkdwn(fact)}`;
    })
    .join('\n');

const formatEvidenceLines = (factSummary: string[]): string =>
  factSummary.map((fact) => `  ↳ 근거: ${escapeSlackMrkdwn(fact)}`).join('\n');
