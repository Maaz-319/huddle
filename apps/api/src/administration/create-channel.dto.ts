import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Length } from 'class-validator';

/**
 * No doc specifies a length limit for `Channel.name`. Matched to
 * `Server.name`'s 1–100, trimmed, for the same reason recorded there.
 */
export const CHANNEL_NAME_LENGTH = [1, 100] as const;

/** Body for `POST /servers/:serverId/channels`. */
export class CreateChannelDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(...CHANNEL_NAME_LENGTH)
  name!: string;

  /**
   * Whether the channel is private, i.e. hidden from everyone without a
   * `ChannelMember` row (administration-service.md section 3).
   *
   * Note a tension with PRD section 5, which lists "Make a channel private"
   * as Owner and Moderator only: this route gates creation on the server's
   * `channelCreationPolicy` alone, so under an `everyone` policy an ordinary
   * Member can create a private channel. #49 specifies it this way
   * deliberately and #52 is where channel-settings authority is decided, so
   * that is where the two should be reconciled — not here, by inventing a
   * rule no ticket asked for.
   */
  @IsBoolean()
  isPrivate!: boolean;
}
