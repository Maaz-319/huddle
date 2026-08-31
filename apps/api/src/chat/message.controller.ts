import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { User } from '../auth/user-repository.interface';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { SnowflakeService } from '../common/snowflake.service';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { ChatService } from './chat.service';
import type { Message } from './message-repository.interface';
import { SendMessageDto } from './send-message.dto';

/**
 * The shape every message route returns — a `Message`, ids serialised per
 * AGENTS.md section 4.
 *
 * `createdAt` is present despite there being no such column: it is decoded
 * from the Snowflake id (docs/architecture/data-model.md section 3), so the
 * absence of the column is invisible to a client.
 *
 * `content` is nullable here while `Message.content` is not. A soft-deleted
 * message is still returned — history renders a "message deleted" placeholder
 * in its place (PRD FR-18/FR-19) — but its text never is.
 */
export interface MessageResponse {
  id: string;
  channelId: string;
  authorId: string;
  content: string | null;
  createdAt: string;
  editedAt: string | null;
  isDeleted: boolean;
}

/**
 * Exported for the same reason `toChannelResponse` is: #61's history route
 * returns arrays of this shape, and two copies of a response mapper is how
 * they drift.
 */
export function toMessageResponse(
  message: Message,
  snowflakes: SnowflakeService,
): MessageResponse {
  return {
    id: message.id.toString(),
    channelId: message.channelId.toString(),
    authorId: message.authorId.toString(),
    // Nulled rather than merely relied upon to be blank. #63 blanks the
    // stored value at delete time; this makes the response correct whether or
    // not that has happened, and keeps it correct for rows written before it.
    content: message.isDeleted ? null : message.content,
    createdAt: snowflakes.timestampFrom(message.id).toISOString(),
    editedAt: message.editedAt === null ? null : message.editedAt.toISOString(),
    isDeleted: message.isDeleted,
  };
}

/** The message routes for one channel. */
@Controller('channels/:channelId/messages')
@UseGuards(SessionAuthGuard)
export class MessageController {
  constructor(
    private readonly chat: ChatService,
    private readonly snowflakes: SnowflakeService,
  ) {}

  /**
   * Posts a message. 201 is Nest's default for `@Post` and is right here: this
   * mints a real resource at a new id.
   *
   * Every permission question is settled before the handler runs. A member
   * whose `post` an override has revoked gets a 403 from the guard; a
   * non-member of a private channel gets the 404 that hides the channel's
   * existence. See `RequireCapabilityGuard`'s own doc for why those two
   * differ.
   *
   * `message-send` is the first channel-dimensioned policy applied to a REST
   * route, so one channel's burst cannot exhaust another's budget — see
   * `RateLimitGuard` for where the channel id comes from.
   */
  @Post()
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('post')
  @RateLimit('message-send')
  async send(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: User,
  ): Promise<MessageResponse> {
    const message = await this.chat.sendMessage(
      channelId,
      user.id,
      dto.content,
    );

    return toMessageResponse(message, this.snowflakes);
  }
}
