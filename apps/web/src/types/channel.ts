export interface ChannelResponse {
  id: string;
  serverId: string;
  name: string;
  isPrivate: boolean;
  createdAt: string;
}

export interface ChannelOverrideResponse {
  channelId: string;
  role: string;
  capability: string;
}

export interface ChannelMemberResponse {
  channelId: string;
  userId: string;
  addedAt: string;
}

export interface ServerMemberResponse {
  userId: string;
  role: 'owner' | 'moderator' | 'member';
  joinedAt: string;
}