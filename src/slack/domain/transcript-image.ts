import {
  SlackTranscriptFile,
  SlackTranscriptMessage,
} from './slack-transcript';

export const MAX_CONVERSATION_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export const SLACK_FILE_HOST = 'files.slack.com';
export interface SelectedImage {
  index: number;
  ts: string;
  file: SlackTranscriptFile;
}
export interface ImageSelection {
  selected: SelectedImage[];
  skippedCount: number;
  labels: Map<string, number[]>;
}
export interface SelectTranscriptImagesInput {
  messages: readonly SlackTranscriptMessage[];
  currentTs?: string;
  speakerUserId: string;
}

export const selectTranscriptImages = ({
  messages,
  currentTs,
  speakerUserId,
}: SelectTranscriptImagesInput): ImageSelection => {
  const sorted = [...messages].sort((left, right) => {
    const priority = (message: SlackTranscriptMessage): number =>
      message.ts === currentTs
        ? 0
        : message.user === speakerUserId && !message.botId
          ? 1
          : 2;
    return (
      priority(left) - priority(right) || Number(right.ts) - Number(left.ts)
    );
  });
  const selected: SelectedImage[] = [];
  const labels = new Map<string, number[]>();
  let skippedCount = 0;
  for (const message of sorted) {
    for (const file of message.files) {
      if (
        !(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.mimetype) ||
        file.size > MAX_IMAGE_BYTES ||
        selected.length >= MAX_CONVERSATION_IMAGES
      ) {
        skippedCount += 1;
        continue;
      }
      const index = selected.length + 1;
      selected.push({ index, ts: message.ts, file });
      labels.set(message.ts, [...(labels.get(message.ts) ?? []), index]);
    }
  }
  return { selected, skippedCount, labels };
};
