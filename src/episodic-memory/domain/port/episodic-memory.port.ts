import {
  EpisodeSearchHit,
  RecordEpisodeInput,
  SearchEpisodesInput,
} from '../episode.type';

// AgentRun 등 소비자가 의존하는 좁은 인터페이스 — 옵셔널 주입용.
export interface EpisodicMemoryPort {
  record(input: RecordEpisodeInput): Promise<void>;
  searchRelevant(input: SearchEpisodesInput): Promise<EpisodeSearchHit[]>;
}

export const EPISODIC_MEMORY_PORT = Symbol('EPISODIC_MEMORY_PORT');
