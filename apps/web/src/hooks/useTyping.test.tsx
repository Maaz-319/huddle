import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTyping } from './useMessages'

const { emitMock, emitNoAckMock } = vi.hoisted(() => ({
  emitMock: vi.fn(() => Promise.resolve()),
  emitNoAckMock: vi.fn(),
}))

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({
    emit: emitMock,
    emitNoAck: emitNoAckMock,
    on: () => () => {},
    isConnected: true,
  }),
}))

const CHANNEL_ID = '890123456789012345'

describe('useTyping', () => {
  beforeEach(() => {
    emitMock.mockClear()
    emitNoAckMock.mockClear()
  })

  it('emits a channelId-only typing frame when composition starts', () => {
    const { result, unmount } = renderHook(() => useTyping(CHANNEL_ID))

    act(() => {
      result.current.startTyping()
    })

    expect(emitNoAckMock).toHaveBeenCalledTimes(1)
    expect(emitNoAckMock).toHaveBeenCalledWith('typing', {
      channelId: CHANNEL_ID,
    })
    expect(emitMock).not.toHaveBeenCalled()

    unmount()
  })

  it('emits nothing when typing stops — the frame schema has no stop signal', () => {
    const { result, unmount } = renderHook(() => useTyping(CHANNEL_ID))

    act(() => {
      result.current.startTyping()
    })
    emitNoAckMock.mockClear()

    act(() => {
      result.current.stopTyping()
    })

    expect(emitNoAckMock).not.toHaveBeenCalled()

    unmount()
  })
})
