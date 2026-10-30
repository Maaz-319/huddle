import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageResponse } from '@/types/socket';
import { Message } from './Message';

const message: MessageResponse = {
  id: 'message-1',
  channelId: 'channel-1',
  authorId: 'user-1',
  author: { id: 'user-1', username: 'ada', avatarUrl: 'https://example.com/avatar.png' },
  content: 'Hello',
  createdAt: new Date(2026, 9, 30, 19, 30).toISOString(),
  editedAt: null,
  isDeleted: false,
};

afterEach(cleanup);

describe('Message author grouping', () => {
  it('shows avatar and identity with a right-aligned local clock time when the group starts', () => {
    const { container, getByText } = render(<Message message={message} isOwn showAuthor />);

    expect(getByText('ada')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(message.author.avatarUrl);
    const time = container.querySelector('time');
    expect(time?.textContent).toBe('7:30 PM');
    expect(time?.getAttribute('datetime')).toBe(message.createdAt);
    expect(time?.getAttribute('title')).toBeNull();
    expect(time?.className).toContain('opacity-0');
    expect(time?.className).toContain('group-hover:opacity-100');
    expect(time?.parentElement?.parentElement?.className).toContain('justify-between');
  });

  it('omits avatar and identity while aligning content and time with the message text column', () => {
    const { container, queryByText, getByText } = render(<Message message={message} isOwn showAuthor={false} />);

    expect(queryByText('ada')).toBeNull();
    expect(queryByText('You')).toBeNull();
    expect(getByText('Hello')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.relative.flex-shrink-0.w-8.h-8')).toBeNull();
    const time = container.querySelector('time');
    expect(time?.textContent).toBe('7:30 PM');
    expect(time?.getAttribute('datetime')).toBe(message.createdAt);
    expect(time?.getAttribute('title')).toBeNull();
    expect(time?.className).toContain('opacity-0');
    expect(time?.className).toContain('group-hover:opacity-100');
    expect(time?.parentElement?.className).toContain('float-right');
    expect(container.querySelector('[data-message-id] > .flex-1')?.getAttribute('style')).toContain('2.75rem');
  });
});
