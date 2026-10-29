import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { authApi } from '@/api/auth';

const TYPING_TTL_MS = 7000;

export function useTyping(channelId: string | null) {
  const { emitNoAck, on } = useSocket();
  const user = useAuthStore((s) => s.user);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiriesRef = useRef<Map<string, number>>(new Map());
  const usernamesRef = useRef<Map<string, string>>(new Map());
  const [typingUsernames, setTypingUsernames] = useState<string[]>([]);

  const pruneAndPublish = useCallback(() => {
    const now = Date.now();
    for (const [id, expiry] of expiriesRef.current) {
      if (expiry <= now) {
        expiriesRef.current.delete(id);
      }
    }
    const next = Array.from(expiriesRef.current.keys()).map(
      (id) => usernamesRef.current.get(id) ?? 'Someone'
    );
    setTypingUsernames((prev) =>
      prev.length === next.length && prev.every((name, i) => name === next[i])
        ? prev
        : next
    );
  }, []);

  // Listen for others typing in this channel
  useEffect(() => {
    if (!channelId) return;

    const unsubscribe = on('typing', ({ channelId: eventChannelId, userId }) => {
      if (eventChannelId !== channelId) return;
      // The server debounces repeats; a fresh event extends the window.
      expiriesRef.current.set(userId, Date.now() + TYPING_TTL_MS);
      pruneAndPublish();

      if (userId !== user?.id && !usernamesRef.current.has(userId)) {
        authApi
          .getUsers([userId])
          .then((users) => {
            if (users[0]) {
              usernamesRef.current.set(userId, users[0].username);
              pruneAndPublish();
            }
          })
          .catch(() => {
            // 'Someone' fallback already published
          });
      } else if (userId === user?.id) {
        // Never show the local user's own typing back to them
        expiriesRef.current.delete(userId);
        pruneAndPublish();
      }
    });

    return unsubscribe;
  }, [channelId, on, user?.id, pruneAndPublish]);

  // Sweep expired entries
  useEffect(() => {
    if (!channelId) return;
    const interval = setInterval(pruneAndPublish, 1000);
    return () => clearInterval(interval);
  }, [channelId, pruneAndPublish]);

  // Clear when leaving the channel
  useEffect(() => {
    const expiries = expiriesRef.current;
    return () => {
      expiries.clear();
      setTypingUsernames([]);
    };
  }, [channelId]);

  // startTyping's timeout calls stopTyping without a TDZ dependency cycle.
  const stopTypingRef = useRef<() => void>(() => {});

  const startTyping = useCallback(() => {
    if (!channelId) return;

    emitNoAck('typing', { channelId });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Auto-stop typing after 5 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      stopTypingRef.current();
    }, 5000);
  }, [channelId, emitNoAck]);

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    stopTypingRef.current = stopTyping;
  }, [stopTyping]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return { startTyping, stopTyping, typingUsernames };
}
