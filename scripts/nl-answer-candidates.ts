import { PrismaClient } from '@prisma/client';

import {
  CandidateReason,
  NlAnswerCandidate,
  toNlAnswerCandidate,
} from '../src/router/eval/nl-answer-candidate';
import { readOnlyPrismaExtension } from '../src/router/eval/read-only-prisma';

/**
 * 운영 원장에서 eval holdout 후보 원문을 뽑는다 — 읽기 전용, 아무것도 고치지 않는다.
 *
 * 사용법: pnpm eval:nl-candidates [--days 14]
 *
 * 출력은 사람이 읽고 고르는 목록이다. 문항으로 넣을 때는 src/router/eval/nl-answer-eval.cases.ts 에
 * 원문 그대로 holdout 으로 추가하고, 기대 답(채점 기준)과 출처(날짜·agentRunId)를 적는다.
 * 원문은 원장에 저장될 때 개인정보가 가려진 값(toLedgerRoutedText)이다.
 */

const DEFAULT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1_000;

const REASON_TITLE: Record<CandidateReason, string> = {
  FALLBACK: '사실 기반 답 대신 표로 답함 (답 생성 실패·숫자 검사 실패)',
  HELD_WRITE: '질문으로 보여 쓰기를 보류함 (실제로 기록을 원했을 수 있음)',
  UNCLASSIFIED: '분류기가 담당을 못 고름 (대화 답변으로 감)',
  FACT_ANSWER: '사실 기반 답을 냄 (답의 질을 표본으로 확인)',
};

const readDays = (): number => {
  const index = process.argv.indexOf('--days');
  const value = index < 0 ? DEFAULT_DAYS : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `--days 는 1 이상의 정수여야 한다 (받은 값: ${process.argv[index + 1]})`,
    );
  }
  return value;
};

const main = async (): Promise<void> => {
  const days = readDays();
  const prisma = new PrismaClient().$extends(readOnlyPrismaExtension);
  try {
    const rows = await prisma.agentRun.findMany({
      where: { startedAt: { gte: new Date(Date.now() - days * DAY_MS) } },
      select: {
        id: true,
        agentType: true,
        startedAt: true,
        inputSnapshot: true,
        output: true,
      },
      orderBy: { startedAt: 'desc' },
    });
    const candidates = rows
      .map((row) => toNlAnswerCandidate(row))
      .filter(
        (candidate): candidate is NlAnswerCandidate => candidate !== null,
      );

    process.stdout.write(
      `# eval holdout 후보 — 최근 ${days}일, 원장 ${rows.length}행 중 ${candidates.length}건\n`,
    );
    for (const reason of Object.keys(REASON_TITLE) as CandidateReason[]) {
      const group = candidates.filter(
        (candidate) => candidate.reason === reason,
      );
      process.stdout.write(
        `\n## ${REASON_TITLE[reason]} — ${group.length}건\n`,
      );
      for (const candidate of group) {
        process.stdout.write(
          `- [${candidate.startedAt.slice(0, 16)} · ${candidate.worker} · run ${candidate.agentRunId}] ${candidate.text}${candidate.detail ? `  (${candidate.detail})` : ''}\n`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
