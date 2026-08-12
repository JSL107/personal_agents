export interface SnapshotManifestSummary {
  sourceHome: string;
  generatedAt: string;
  claude?: { plugins: number; mcpServers: number; assets: number };
  codex?: { plugins: number; mcpServers: number; assets: number };
}

export interface SnapshotStatus {
  available: boolean;
  headSha?: string;
  appliedSha?: string;
  summary?: SnapshotManifestSummary;
}

export interface AiCliEnvApplyPayload {
  snapshotSha: string;
  slackUserId: string;
}
