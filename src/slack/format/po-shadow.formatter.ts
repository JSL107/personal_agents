import {
  PoShadowFindingReference,
  PoShadowRecoverySummary,
  PoShadowReport,
} from '../../agent/po-shadow/domain/po-shadow.type';
import {
  escapeSlackMrkdwn,
  isSafeHttpUrl,
  sanitizeForSlackLink,
} from './mrkdwn.util';

export interface PoShadowFormatOptions {
  // true 면 지적별 근거 줄과 지난 지적 통계를 빼고 `formatPoShadowDetail` 이 스레드로 싣는다.
  // 스레드가 없는 슬래시 응답은 기본값(false)으로 전부 한 통에 싣는다.
  detailInThread?: boolean;
}

// 조회하지 못한 소스는 조용한 날에도, 지적이 있는 날에도 그대로 밝힌다. "이상 없음" 과
// "못 봤음" 이 같은 글자로 나가면 카드가 조용한 고장을 덮는다.
export const formatPoShadowReport = (
  report: PoShadowReport,
  { detailInThread = false }: PoShadowFormatOptions = {},
): string => {
  if (report.quiet) {
    return formatQuietReport(report);
  }

  // `*…*` 만 있는 줄이라 공통 렌더가 제목 블록으로 올린다. 몇 가지를 말하는지 먼저 보여 준다.
  const title =
    report.findings.length > 0
      ? `*PO 검토 — 계획과 다른 점 ${report.findings.length}가지*`
      : '*PO 검토*';
  const sections = [title, `🎯 *먼저* ${escapeSlackMrkdwn(report.headline)}`];

  if (report.findings.length > 0) {
    sections.push(formatFindings(report, !detailInThread));
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

  const recoveryBlock = detailInThread
    ? null
    : formatRecoveryBlock(report.recoverySummary);
  if (recoveryBlock) {
    sections.push(recoveryBlock);
  }

  const checkInBlock = formatGoalCheckIns(report.goalCheckIns);
  if (checkInBlock) {
    sections.push(checkInBlock);
  }

  const degradedLine = formatDegradedLine(report.degradedSources);
  if (degradedLine) {
    sections.push(degradedLine);
  }

  return sections.join('\n\n');
};

// `detailInThread` 로 메인에서 뺀 것 — 지적별 근거와 지난 지적 통계. 근거는 사실표 라벨 그대로라
// ("…#3753 — 지난 지적 — 머지됨") 메인에서는 읽히지 않지만, 지적이 지어낸 말이 아님을 확인할 자리는 남긴다.
export const formatPoShadowDetail = (report: PoShadowReport): string | null => {
  if (report.quiet) {
    return null;
  }
  const sections: string[] = [];
  if (report.findings.length > 0) {
    const evidence = report.findings
      .map((_, index) => report.factSummary[index])
      .map((fact, index) =>
        fact === undefined ? null : `${index + 1}. ${escapeSlackMrkdwn(fact)}`,
      )
      .filter((line): line is string => line !== null);
    if (evidence.length > 0) {
      sections.push(['*지적별 근거*', ...evidence].join('\n'));
    }
  }
  const recoveryBlock = formatRecoveryBlock(report.recoverySummary);
  if (recoveryBlock) {
    sections.push(recoveryBlock);
  }
  return sections.length > 0 ? sections.join('\n\n') : null;
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

// 묵은 목표 질문. 닫기는 사용자가 한다 — 닫는 말을 함께 알려 준다.
const formatGoalCheckIns = (checkIns: string[] | undefined): string | null => {
  if (checkIns === undefined || checkIns.length === 0) {
    return null;
  }
  const lines = checkIns.map((line) => `• ${escapeSlackMrkdwn(line)}`);
  return [
    '🧭 *목표 점검*',
    ...lines,
    '_더 유효하지 않으면 "<제목> 목표 닫아줘" 로 닫아 주세요._',
  ].join('\n');
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
  const checkInBlock = formatGoalCheckIns(report.goalCheckIns);
  if (checkInBlock) {
    blocks.push(checkInBlock);
  }
  const degradedLine = formatDegradedLine(report.degradedSources);
  if (degradedLine) {
    blocks.push(degradedLine);
  }
  return blocks.join('\n\n');
};

// 저장소·번호·원래 제목을 링크로 — 모델이 줄여 쓴 "#3922 학교 관리자용" 만으로는 무슨 일인지 모른다.
const formatReferences = (
  references: PoShadowFindingReference[] | undefined,
): string => {
  if (!references || references.length === 0) {
    return '';
  }
  const items = references.map((reference) =>
    reference.url && isSafeHttpUrl(reference.url)
      ? `<${sanitizeForSlackLink(reference.url)}|${sanitizeForSlackLink(reference.text)}>`
      : escapeSlackMrkdwn(reference.text),
  );
  // 한 줄에 이어 붙이면 어디서 항목이 갈리는지 안 보인다 — 한 줄에 하나.
  return items.map((item) => `\n      • ${item}`).join('');
};

// 상황과 할 일을 한 줄에 대시로 이으면 어디까지가 상황인지 안 보인다 — 할 일을 다음 줄 화살표로 뗀다.
const formatFindings = (
  report: PoShadowReport,
  includeEvidence: boolean,
): string =>
  report.findings
    .map((finding, index) => {
      const point = escapeSlackMrkdwn(finding.point);
      const suggestion = escapeSlackMrkdwn(finding.suggestion);
      const references = formatReferences(report.findingReferences?.[index]);
      const findingLines = `${index + 1}. ${point}${references}\n      → ${suggestion}`;
      const fact = report.factSummary[index];
      if (!includeEvidence || fact === undefined) {
        return findingLines;
      }
      return `${findingLines}\n      근거: ${escapeSlackMrkdwn(fact)}`;
    })
    .join('\n');

const formatEvidenceLines = (factSummary: string[]): string =>
  factSummary.map((fact) => `근거: ${escapeSlackMrkdwn(fact)}`).join('\n');
