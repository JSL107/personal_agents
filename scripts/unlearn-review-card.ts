import { PrismaClient } from '@prisma/client';

import {
  CONVENTION_WINDOW_DAYS,
  renderLearnedConventions,
} from '../src/agent/code-reviewer/domain/prompt/learned-conventions';
import { PrReviewFindingPrismaRepository } from '../src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// 리뷰 카드 한 건을 학습 재료에서 빼는 수단.
//
// 왜 필요한가 — 정탐 카드에 실수로 👎 를 누르면 그 기각 이유가 `CONVENTION_WINDOW_DAYS`
// 동안 이 레포의 규약으로 다음 리뷰 프롬프트에 실린다(`learned-conventions.ts`). 좋은 지적을
// 피하도록 가르치는 역학습인데, 되돌릴 방법이 없어 자연 만료를 기다리는 수밖에 없었다.
//
// **왜 새 컬럼이 아닌가** — 학습 재료 조회(`findRejectionsForConventions`)가 보는 것은
// `status = 'REJECTED'` 와 이유의 유무 둘뿐이다. 정탐에 👎 를 눌렀다는 것은 실제 결론이
// 채택이었다는 뜻이므로, 상태를 `ACKED` 로 바로잡으면 규약에서 빠지는 동시에 채택률
// (`summarizeAdoption`)도 제 값으로 돌아온다. 제외 플래그를 따로 두면 채택률은 계속
// 기각으로 세어져 절반만 고쳐진다.
//
// 🔴 **`OPEN` 으로 되돌리지 않는다.** 재수확 조회가 `status='OPEN' AND resolvedAt IS NULL`
// 이라(`findOpenPostedCards`) 다음 스윕이 GitHub 에 남은 👎 를 다시 읽어 `REJECTED` 로
// 돌려놓는다. `ACKED` 로 결론난 카드는 어느 스윕도 건드리지 않는다.

const USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/unlearn-review-card.ts <카드id>            # 미리보기(변경 없음)\n' +
  '  pnpm exec ts-node scripts/unlearn-review-card.ts <카드id> --apply    # 실제 적용\n' +
  '\n카드 id 는 리뷰 카드(pr_review_finding)의 id 다. GitHub 코멘트 id 가 아니다.';

/**
 * 미리보기 롤백 신호.
 *
 * 미리보기와 적용이 같은 코드를 지나게 하려고 갱신까지 실제로 해 보고 트랜잭션을 되돌린다.
 * 미리보기용 조회를 따로 짜면 그 조건이 실제 조회와 갈려, "미리보기는 사라졌다고 했는데
 * 규약에는 남는" 상태를 만들 수 있다.
 */
class PreviewOnly extends Error {}

const formatCard = (card: {
  id: number;
  repo: string;
  pullNumber: number;
  category: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  decidedAt: Date | null;
  rejectReason: string | null;
}): string =>
  [
    `카드 #${card.id} — ${card.repo} PR #${card.pullNumber}`,
    `  분류: ${card.category} / ${card.severity}`,
    `  위치: ${card.filePath ?? '(파일 없음)'}${card.line === null ? '' : `:${card.line}`}`,
    `  결론: ${card.decidedAt === null ? '(시각 없음)' : card.decidedAt.toISOString()}`,
    `  기각 이유: ${card.rejectReason ?? '(없음)'}`,
  ].join('\n');

// 10진수 양의 정수만 받는다. `Number()` 하나로 판정하면 `1e2`·`0x10` 이 각각 카드 100·16 으로
// 조용히 바뀌어, 사람이 지목한 것과 다른 카드를 건드린다.
const CARD_ID_PATTERN = /^[1-9][0-9]*$/;

const main = async (): Promise<void> => {
  const [idArgument, ...restArguments] = process.argv.slice(2);
  // `--apply` 오타(`--appl`)를 조용히 미리보기로 흘리지 않는다 — 적용한 줄 알고 넘어가게 된다.
  const apply = restArguments.length === 1 && restArguments[0] === '--apply';
  if (
    idArgument === undefined ||
    !CARD_ID_PATTERN.test(idArgument) ||
    (restArguments.length > 0 && !apply)
  ) {
    console.error(USAGE);
    process.exit(1);
  }
  const cardId = Number(idArgument);

  const prisma = new PrismaClient();
  try {
    const card = await prisma.prReviewFinding.findUnique({
      where: { id: cardId },
    });
    if (card === null) {
      console.error(`[거부] 카드 #${cardId} 가 없다.`);
      process.exit(1);
    }
    if (card.status !== 'REJECTED') {
      console.error(
        `[거부] 카드 #${cardId} 의 상태가 ${card.status} 다 — 기각(REJECTED) 카드만 학습에서 뺄 수 있다.\n` +
          '기각이 아닌 카드는 애초에 규약 재료가 아니다.',
      );
      process.exit(1);
    }

    console.log(formatCard(card));
    console.log('');

    const since = new Date(
      Date.now() - CONVENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    await prisma.$transaction(async (tx) => {
      // repository 가 쓰는 것은 `prisma.prReviewFinding.*` 뿐이라 트랜잭션 클라이언트로
      // 그대로 동작한다. 조회 조건을 여기서 다시 쓰지 않기 위한 캐스팅이다.
      const repository = new PrReviewFindingPrismaRepository(
        tx as unknown as PrismaService,
      );
      const before = renderLearnedConventions(
        await repository.findRejectionsForConventions({
          repo: card.repo,
          since,
        }),
      );
      await tx.prReviewFinding.update({
        where: { id: cardId },
        data: { status: 'ACKED', rejectReason: null },
      });
      const after = renderLearnedConventions(
        await repository.findRejectionsForConventions({
          repo: card.repo,
          since,
        }),
      );

      const listCategories = (categories: string[]): string =>
        categories.length === 0 ? '없음' : categories.join(', ');
      console.log(
        `규약이 선 카테고리: ${listCategories(before.categories)} → ${listCategories(after.categories)}`,
      );
      console.log(
        `규약 블록 길이: ${before.block.length}자 → ${after.block.length}자`,
      );
      if (before.block === after.block) {
        console.log(
          '\n⚠️  규약 블록이 그대로다 — 이 카드는 지금 프롬프트에 실리지 않는다' +
            '(카테고리당 노출 상한 밖, 또는 이유가 길이 하한 미달).\n' +
            '   빼 두면 나중에 상한 안으로 들어오는 일은 막힌다.',
        );
      }
      console.log('\n--- 뺀 뒤의 규약 블록 (위 기각 이유가 없어야 정상) ---');
      console.log(
        after.block === '' ? '(빈 블록 — 실릴 규약 없음)' : after.block,
      );

      if (!apply) {
        throw new PreviewOnly();
      }
    });

    console.log(
      `\n[적용] 카드 #${cardId} → ACKED (기각 이유 삭제). 다음 리뷰부터 규약 재료에서 빠진다.\n` +
        'GitHub 에 남은 👎 리액션은 손으로 지울 것 — 사람이 PR 을 다시 볼 때 판정이 어긋나 보인다.',
    );
  } catch (error) {
    if (error instanceof PreviewOnly) {
      console.log(
        '\n[미리보기] 아무것도 바꾸지 않았다. 적용하려면 --apply 를 붙일 것.',
      );
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
