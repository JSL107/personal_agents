import { ArtJobKeywordKind, ArtJobKeywordSet } from '../art-job-keyword';

export const ART_JOB_KEYWORD_REPOSITORY_PORT = Symbol(
  'ART_JOB_KEYWORD_REPOSITORY_PORT',
);

export interface ArtJobKeywordAddResult {
  added: string[];
  existing: string[];
}

export interface ArtJobKeywordRemoveResult {
  removed: string[];
  missing: string[];
}

export interface ArtJobKeywordRepositoryPort {
  load(): Promise<ArtJobKeywordSet>;
  add(
    kind: ArtJobKeywordKind,
    terms: string[],
    actor: string,
  ): Promise<ArtJobKeywordAddResult>;
  remove(
    kind: ArtJobKeywordKind,
    terms: string[],
    actor: string,
  ): Promise<ArtJobKeywordRemoveResult>;
}
