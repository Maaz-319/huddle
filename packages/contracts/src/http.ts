import type {
  Capability,
  ChannelCreationPolicy,
  OverrideRole,
  ServerRole,
} from './permissions.js';

export interface UserResponse {
  id: string;
  username: string;
  avatarUrl: string;
  email: string;
  bio: string | null;
}

export type MeResponse = UserResponse;

/** Public profile fields used to label another user in member lists/messages. */
export type UserSummaryResponse = Pick<
  UserResponse,
  'id' | 'username' | 'avatarUrl' | 'bio'
>;

export interface ServerResponse {
  id: string;
  name: string;
  iconUrl: string | null;
  channelCreationPolicy: ChannelCreationPolicy;
  memberInviteToggle: boolean;
  createdAt: string;
}

export interface MembershipResponse {
  userId: string;
  role: ServerRole;
  joinedAt: string;
}

export type ServerMemberResponse = MembershipResponse;

export interface InviteResponse {
  code: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface InvitePreviewResponse {
  server: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
}

export interface ChannelResponse {
  id: string;
  serverId: string;
  name: string;
  isPrivate: boolean;
  createdAt: string;
  myCapabilities: Capability[];
}

export interface ChannelOverrideResponse {
  channelId: string;
  role: OverrideRole;
  capability: Capability;
}

export interface ChannelMemberResponse {
  channelId: string;
  userId: string;
  addedAt: string;
}

export interface MessageAuthorResponse {
  id: string;
  username: string;
  avatarUrl: string;
}

export interface MessageResponse {
  id: string;
  channelId: string;
  authorId: string;
  author: MessageAuthorResponse;
  content: string | null;
  createdAt: string;
  editedAt: string | null;
  isDeleted: boolean;
}

export interface MessagePageResponse {
  messages: MessageResponse[];
  hasMore: boolean;
}

export interface MessageDeleteResponse {
  id: string;
  channelId: string;
}
