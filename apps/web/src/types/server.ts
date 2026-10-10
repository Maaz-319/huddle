export interface ServerResponse {
  id: string;
  name: string;
  iconUrl: string | null;
  channelCreationPolicy: 'owner' | 'moderator' | 'member';
  memberInviteToggle: boolean;
  createdAt: string;
}

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