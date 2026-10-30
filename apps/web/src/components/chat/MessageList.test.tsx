import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageResponse } from '@/types/socket';

const virtualizerMock = vi.hoisted(() => ({ measureElement: vi.fn() }));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number;
    estimateSize: (index: number) => number;
    paddingStart?: number;
  }) => {
    let start = options.paddingStart ?? 0;
    const virtualItems = Array.from({ length: options.count }, (_, index) => {
      const size = options.estimateSize(index);
      const item = { index, start, size, end: start + size, key: index, lane: 0 };
      start += size;
      return item;
    });

    return {
      getVirtualItems: () => virtualItems,
      getTotalSize: () => start,
      measureElement: virtualizerMock.measureElement,
    };
  },
}));

import { MessageList } from './MessageList';

afterEach(() => {
  cleanup();
  virtualizerMock.measureElement.mockClear();
});

function message(id: string, createdAt: string): MessageResponse {
  return {
    id,
    channelId: 'channel-1',
    authorId: 'user-1',
    author: { id: 'user-1', username: 'ada', avatarUrl: '' },
    content: `message ${id}`,
    createdAt,
    editedAt: null,
    isDeleted: false,
  };
}

describe('MessageList date dividers', () => {
  it('renders and measures divider rows alongside messages, with the transcript scrollbar hidden', () => {
    const messages = [
      message('1', '2026-10-30T23:59:00.000Z'),
      message('2', '2026-10-31T00:01:00.000Z'),
    ];
    const { container, getByText, getAllByRole } = render(
      <MessageList
        messages={messages}
        isOwn={() => false}
        onEdit={async () => undefined}
        onDelete={async () => undefined}
        onCopy={() => undefined}
        onRetry={async () => undefined}
        onDiscard={() => undefined}
        onLoadOlder={() => undefined}
        hasMore={false}
        loading={false}
        scrolledToBottom={false}
        setScrolledToBottom={() => undefined}
      />,
    );

    expect(getAllByRole('separator')).toHaveLength(2);
    expect(getByText('message 1')).toBeTruthy();
    expect(getByText('message 2')).toBeTruthy();
    const transcript = container.querySelector('.scrollbar-hidden');
    expect(transcript).toBeTruthy();
    expect(transcript?.classList.contains('overflow-y-auto')).toBe(true);
    const measuredRows = virtualizerMock.measureElement.mock.calls
      .map(([element]) => element)
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    expect(measuredRows.map((element) => element.dataset.index)).toEqual(['0', '1', '2', '3']);
  });
});
