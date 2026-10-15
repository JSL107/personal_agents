import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ART_JOB_KEYWORD_SEED,
  ArtJobKeywordKind,
  ArtJobKeywordSet,
  normalizeKeywordTerm,
  validateKeywordTerm,
} from '../domain/art-job-keyword';
import {
  ArtJobKeywordAddResult,
  ArtJobKeywordRemoveResult,
  ArtJobKeywordRepositoryPort,
} from '../domain/port/art-job-keyword.repository.port';

const KIND_FIELDS: Record<ArtJobKeywordKind, keyof ArtJobKeywordSet> = {
  TARGET: 'target',
  EXCLUDED: 'excluded',
  STYLE: 'style',
};

const KINDS: ArtJobKeywordKind[] = ['TARGET', 'EXCLUDED', 'STYLE'];

const normalizedUniqueTerms = (terms: string[]): string[] => {
  const unique = new Map<string, string>();
  for (const raw of terms) {
    const error = validateKeywordTerm(raw);
    if (error) {
      throw new Error(error);
    }
    const term = normalizeKeywordTerm(raw);
    const key = term.toLocaleLowerCase();
    if (!unique.has(key)) {
      unique.set(key, term);
    }
  }
  return [...unique.values()];
};

@Injectable()
export class ArtJobKeywordPrismaRepository implements ArtJobKeywordRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt === 2
        ) {
          throw error;
        }
      }
    }
    throw new Error('키워드 트랜잭션을 완료하지 못했습니다.');
  }

  async load(): Promise<ArtJobKeywordSet> {
    return await this.serializable(async (transaction) => {
      await this.seedIfNeeded(transaction);
      const rows = await transaction.artJobKeyword.findMany({
        orderBy: { id: 'asc' },
        select: { kind: true, term: true },
      });
      const keywords: ArtJobKeywordSet = {
        target: [],
        excluded: [],
        style: [],
      };
      for (const row of rows) {
        if (row.kind in KIND_FIELDS) {
          keywords[KIND_FIELDS[row.kind as ArtJobKeywordKind]].push(row.term);
        }
      }
      return keywords;
    });
  }

  async add(
    kind: ArtJobKeywordKind,
    terms: string[],
    actor: string,
  ): Promise<ArtJobKeywordAddResult> {
    const normalized = normalizedUniqueTerms(terms);
    return await this.serializable(async (transaction) => {
      await this.seedIfNeeded(transaction);
      const rows = await transaction.artJobKeyword.findMany({
        where: { kind },
        select: { term: true },
      });
      const known = new Set(rows.map((row) => row.term.toLocaleLowerCase()));
      const added = normalized.filter(
        (term) => !known.has(term.toLocaleLowerCase()),
      );
      const existing = normalized.filter((term) =>
        known.has(term.toLocaleLowerCase()),
      );
      if (added.length > 0) {
        await transaction.artJobKeyword.createMany({
          data: added.map((term) => ({ kind, term, createdBy: actor })),
          skipDuplicates: true,
        });
        await transaction.artJobKeywordChange.createMany({
          data: added.map((term) => ({ action: 'ADD', kind, term, actor })),
        });
      }
      return { added, existing };
    });
  }

  async remove(
    kind: ArtJobKeywordKind,
    terms: string[],
    actor: string,
  ): Promise<ArtJobKeywordRemoveResult> {
    const normalized = normalizedUniqueTerms(terms);
    return await this.serializable(async (transaction) => {
      await this.seedIfNeeded(transaction);
      const rows = await transaction.artJobKeyword.findMany({
        where: { kind },
        select: { id: true, term: true },
      });
      const known = new Map(
        rows.map((row) => [row.term.toLocaleLowerCase(), row]),
      );
      const found = normalized
        .map((term) => known.get(term.toLocaleLowerCase()))
        .filter((row): row is (typeof rows)[number] => row !== undefined);
      const removed = found.map((row) => row.term);
      const missing = normalized.filter(
        (term) => !known.has(term.toLocaleLowerCase()),
      );
      if (found.length > 0) {
        await transaction.artJobKeyword.deleteMany({
          where: { id: { in: found.map((row) => row.id) } },
        });
        await transaction.artJobKeywordChange.createMany({
          data: removed.map((term) => ({
            action: 'REMOVE',
            kind,
            term,
            actor,
          })),
        });
      }
      return { removed, missing };
    });
  }

  private async seedIfNeeded(
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const changeCount = await transaction.artJobKeywordChange.count();
    if (changeCount !== 0) {
      return;
    }
    const seedRows = KINDS.flatMap((kind) => {
      return ART_JOB_KEYWORD_SEED[KIND_FIELDS[kind]].map((term) => ({
        kind,
        term,
      }));
    });
    await transaction.artJobKeyword.createMany({
      data: seedRows.map((row) => ({ ...row, createdBy: 'SEED' })),
      skipDuplicates: true,
    });
    await transaction.artJobKeywordChange.createMany({
      data: seedRows.map((row) => ({
        ...row,
        action: 'ADD',
        actor: 'SEED',
      })),
      skipDuplicates: true,
    });
  }
}
