import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { CHANNEL_NAME_LENGTH } from './create-channel.dto';

/**
 * Body for `PATCH /channels/:channelId`. Every field is optional, so an empty
 * body is a valid no-op update rather than a 400 — the same shape as
 * `UpdateServerDto`.
 *
 * There is deliberately no privacy check here to match
 * `CreateChannelDto`'s. This route sits behind
 * `@RequireCapability('manage_settings')`, which a Member never holds
 * anywhere, so the caller is already an Owner or a Moderator by the time the
 * body is read and PRD section 5's rule is satisfied structurally.
 */
export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(...CHANNEL_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}
