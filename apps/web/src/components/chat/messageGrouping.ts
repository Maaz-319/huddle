import type { MessageResponse } from '@/types/socket';

export type TranscriptRow =
  | { kind: 'date'; dayKey: string; label: string }
  | { kind: 'message'; message: MessageResponse; messageIndex: number };

const utcDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Add one UTC calendar-date row before each day's first message. */
export function buildTranscriptRows(messages: MessageResponse[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let previousDayKey: string | null = null;

  messages.forEach((message, messageIndex) => {
    const date = new Date(message.createdAt);
    const dayKey = Number.isNaN(date.getTime()) ? 'unknown-date' : date.toISOString().slice(0, 10);
    if (dayKey !== previousDayKey) {
      rows.push({
        kind: 'date',
        dayKey,
        label: Number.isNaN(date.getTime()) ? 'Unknown date' : utcDateFormatter.format(date),
      });
      previousDayKey = dayKey;
    }
    rows.push({ kind: 'message', message, messageIndex });
  });

  return rows;
}

/** Identity is shown for the first message and whenever the author changes. */
export function startsAuthorGroup(messages: MessageResponse[], index: number): boolean {
  const message = messages[index];
  if (!message) return false;
  return index === 0 || messages[index - 1]?.authorId !== message.authorId;
}
