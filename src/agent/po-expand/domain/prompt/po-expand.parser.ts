import { PoOutline } from '../po-expand.type';

export const parsePoOutline = (subject: string, text: string): PoOutline => {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    return { subject, outline: [text.trim()], clarifyingQuestions: [] };
  }
  try {
    const parsed = JSON.parse(match[1]) as {
      outline?: unknown;
      clarifyingQuestions?: unknown;
    };
    return {
      subject,
      outline: Array.isArray(parsed.outline)
        ? (parsed.outline as string[])
        : [],
      clarifyingQuestions: Array.isArray(parsed.clarifyingQuestions)
        ? (parsed.clarifyingQuestions as string[])
        : [],
    };
  } catch {
    return { subject, outline: [text.trim()], clarifyingQuestions: [] };
  }
};
