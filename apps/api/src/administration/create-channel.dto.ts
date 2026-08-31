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
   * `true` is refused for an ordinary Member, whatever the server's
   * `channelCreationPolicy` says: PRD section 5 lists "Make a channel
   * private" as Owner and Moderator only, and that is a different question
   * from who may create a channel at all. The check is not here — it needs
   * the caller's role, which a DTO has no access to — but in
   * `AdministrationService.createChannel`, which is also where the reasoning
   * is written down.
   */
  @IsBoolean()
  isPrivate!: boolean;
}
