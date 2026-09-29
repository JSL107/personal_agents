import { CodeChunk } from './code-chunk.type';

// Candidate identifiers are local to one judgement; persisted references use file and line instead.
export interface KeywordCandidate extends CodeChunk {
  id: string;
  score: number;
}

// Exclude tokens appearing in at least two percent of chunk names.
export const COMMON_TOKEN_RATIO = 0.02;

export const tokenizeIdentifier = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
