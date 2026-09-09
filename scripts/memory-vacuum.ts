import { ConfigService } from '@nestjs/config';

import { MemoryVacuumService } from '../src/memory-vacuum/application/memory-vacuum.service';
import {
  INDEX_SIZE_LIMIT_BYTES,
  INDEX_TARGET_BYTES,
} from '../src/memory-vacuum/domain/memory-index.analyzer';
import { MemoryStoreFsAdapter } from '../src/memory-vacuum/infrastructure/memory-store.fs.adapter';

// 세션 기억 색인 청소 수동 진입점.
//   pnpm memory:vacuum           # 진단만 (파일 안 씀)
//   pnpm memory:vacuum --apply   # 실제 청소 (색인 백업 후 쓰기)
//
// AppModule 을 부팅하지 않는다 — 검증용 전체 부팅이 실행 중인 서비스의 repeatable job 을
// 지운 사고가 있었다. 여기서는 어댑터와 서비스만 직접 만든다.
const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const configService = {
    get: (): undefined => undefined,
  } as unknown as ConfigService;
  const service = new MemoryVacuumService(
    new MemoryStoreFsAdapter(configService),
  );

  const { outcomes, failures } = await service.run({ apply });
  const toKb = (bytes: number): string => `${(bytes / 1024).toFixed(1)}KB`;

  console.log(
    `기억 색인 ${apply ? '청소' : '진단'} — 프로젝트 ${outcomes.length}곳 ` +
      `(상한 ${toKb(INDEX_SIZE_LIMIT_BYTES)} / 목표 ${toKb(INDEX_TARGET_BYTES)})\n`,
  );

  for (const outcome of outcomes) {
    const { before } = outcome;
    const dusty =
      before.dust.orphans.length +
      before.dust.brokenLinks.length +
      before.dust.overflowBytes;
    if (dusty === 0 && outcome.actions.length === 0) {
      continue;
    }
    console.log(
      `▸ ${outcome.project} — 색인 ${toKb(before.indexBytes)} · 항목 ${before.entryCount} · 파일 ${before.fileCount}`,
    );
    if (before.dust.orphans.length > 0) {
      console.log(`    색인 누락 ${before.dust.orphans.length}건`);
    }
    if (before.dust.brokenLinks.length > 0) {
      console.log(`    죽은 링크 ${before.dust.brokenLinks.length}건`);
    }
    if (before.dust.overflowBytes > 0) {
      console.log(`    상한 초과 ${toKb(before.dust.overflowBytes)}`);
    }
    for (const action of outcome.actions) {
      console.log(`    ${apply ? '✅' : '→'} ${action.type} ${action.count}건`);
    }
    if (outcome.remainingOverflowBytes > 0) {
      const candidates = outcome.before.foldCandidates
        .slice(0, 5)
        .map((candidate) => `${candidate.prefix}(${candidate.count})`)
        .join(' · ');
      console.log(
        `    ⚠️ 청소 뒤에도 ${toKb(outcome.remainingOverflowBytes)} 초과 — 사람 판단 필요` +
          (candidates.length > 0 ? `\n       묶음 후보: ${candidates}` : ''),
      );
    }
    console.log('');
  }

  for (const failure of failures) {
    console.error(`🔴 ${failure.project}: ${failure.reason}`);
  }
  // 로그만 남기고 0 으로 끝내면 호출자(자동화·CI)가 적용 실패를 감지할 수 없다.
  if (failures.length > 0) {
    process.exitCode = 1;
  }
  if (!apply) {
    console.log('※ 진단만 했습니다. 실제로 고치려면 --apply 를 붙이세요.');
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
