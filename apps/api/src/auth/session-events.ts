/** In-process revocation events; Huddle currently runs as one API instance. */
export const SESSION_REVOKED = 'auth.session_revoked';
export const USER_SESSIONS_REVOKED = 'auth.user_sessions_revoked';

export interface SessionRevoked {
  sessionId: string;
}

export interface UserSessionsRevoked {
  userId: bigint;
}
