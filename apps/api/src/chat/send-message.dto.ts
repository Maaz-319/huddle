import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/**
 * The content ceiling from docs/architecture/chat-service.md section 3,
 * measured *after* trimming — 2048 characters of message, not 2048 characters
 * of which some are the whitespace we are about to throw away.
 */
export const MESSAGE_CONTENT_MAX = 2048;

/**
 * Body for `POST /channels/:channelId/messages`.
 *
 * Written once here and reused by the edit route (#62) rather than restated,
 * so the two cannot disagree about what a valid message is.
 *
 * `@Transform` runs before the validators, which is what makes the order in
 * chat-service.md section 3 fall out for free: the trim happens first, so
 * whitespace-only content arrives at `@Length` as the empty string and is
 * rejected by the same rule that rejects `""`. The cap is likewise measured
 * against the trimmed value.
 *
 * The trimmed string is then stored inert. The server never parses it as HTML
 * or Markdown and never escapes it — escaping is the client's job at render
 * time, and doing it here would mean storing `&amp;` where a person typed
 * `&`.
 */
export class SendMessageDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, MESSAGE_CONTENT_MAX)
  content!: string;
}
