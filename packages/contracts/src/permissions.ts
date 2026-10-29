export const SERVER_ROLES = ['owner', 'moderator', 'member'] as const;
export type ServerRole = (typeof SERVER_ROLES)[number];

export const OVERRIDE_ROLES = ['moderator', 'member'] as const;
export type OverrideRole = (typeof OVERRIDE_ROLES)[number];

export const CHANNEL_CAPABILITIES = [
  'view',
  'post',
  'delete_others',
  'manage_settings',
] as const;
export type Capability = (typeof CHANNEL_CAPABILITIES)[number];

export const CHANNEL_CREATION_POLICIES = [
  'owner_only',
  'everyone',
  'mods_only',
] as const;
export type ChannelCreationPolicy = (typeof CHANNEL_CREATION_POLICIES)[number];
