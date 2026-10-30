import { describe, expect, it } from 'vitest';
import type { MessageResponse } from '@/types/socket';
import { buildTranscriptRows, startsAuthorGroup } from './messageGrouping';

function message(id: string, authorId: string, createdAt = '2026-10-30T12:00:00.000Z'): MessageResponse {
  return {
    id,
    channelId: 'channel-1',
    authorId,
    author: { id: authorId, username: authorId, avatarUrl: '' },
    content: id,
    createdAt,
    editedAt: null,
    isDeleted: false,
  };
}

describe('startsAuthorGroup', () => {
  it('shows author identity on the first message and after the author changes', () => {
    const messages = [message('1', 'ada'), message('2', 'ada'), message('3', 'grace'), message('4', 'grace')];

    expect(messages.map((_, index) => startsAuthorGroup(messages, index))).toEqual([true, false, true, false]);
  });

  it('starts a new group when history is prepended before the current first message', () => {
    const messages = [message('older', 'grace'), message('current', 'ada'), message('next', 'ada')];

    expect(messages.map((_, index) => startsAuthorGroup(messages, index))).toEqual([true, true, false]);
  });

  it('returns false for an index without a message', () => {
    expect(startsAuthorGroup([], 0)).toBe(false);
  });
});

describe('buildTranscriptRows', () => {
  it('inserts one UTC date divider before each day and none between same-day messages', () => {
    const messages = [
      message('1', 'ada', '2026-10-30T23:59:59.999Z'),
      message('2', 'grace', '2026-10-30T23:59:59.999Z'),
      message('3', 'ada', '2026-10-31T00:00:00.000Z'),
      message('4', 'ada', '2026-10-31T23:59:59.999Z'),
    ];

    expect(buildTranscriptRows(messages).map((row) => row.kind === 'date' ? row.dayKey : row.message.id)).toEqual([
      '2026-10-30', '1', '2', '2026-10-31', '3', '4',
    ]);
  });

  it('uses the UTC date for the divider label', () => {
    const [divider] = buildTranscriptRows([message('1', 'ada', '2026-10-30T23:30:00.000Z')]);
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(new Date('2026-10-30T23:30:00.000Z'));

    expect(divider).toMatchObject({ kind: 'date', dayKey: '2026-10-30', label: expected });
  });
});
