import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { User } from '../auth/user-repository.interface';
import { CursorPaginationDto } from '../common/pagination.dto';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { SnowflakeService } from '../common/snowflake.service';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import {
  MessageResponse,
  MessagePageResponse,
  toMessageResponse,
} from './message-response';
import { SendMessageDto } from './send-message.dto';

/** The message routes for one channel. */
@Controller('channels/:channelId/messages')
@UseGuards(SessionAuthGuard)
export class MessageController {
  constructor(
    private readonly chat: ChatService,
    private readonly snowflakes: SnowflakeService,
    private readonly gateway: ChatGateway,
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
   *
   * The response doubles as the `message_create` broadcast: the gateway is
   * the one thing that knows rooms exist, so this hands it the already-shaped
   * payload rather than emitting here or re-deriving it there (#65 — one
   * write path, one emit site).
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
    const message = await this.chat.postMessage(
      channelId,
      user.id,
      dto.content,
    );
    const response = toMessageResponse(message, this.snowflakes);

    this.gateway.broadcast(channelId, response);

    return response;
  }

  /**
   * Edits a message. Only the author may edit their own message — not a
   * moderator, not the server owner. Editing requires `post`, consistent with
   * #62: losing `post` freezes your history.
   *
   * The route is nested under `:channelId` on purpose: `RequireCapabilityGuard`
   * resolves capability from the `:channelId` route param and cannot work
   * without one. The service still verifies `message.channelId` matches,
   * because the guard proves nothing about which channel the *message* lives
   * in — only which channel the *capability* was resolved for.
   *
   * Content validation is reused from `SendMessageDto` — same trim, same
   * empty rejection, same 2048-character cap.
   */
  @Patch(':messageId')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('post')
  @RateLimit('strict-mutation')
  @HttpCode(200)
  async edit(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Param('messageId', ParseSnowflakePipe) messageId: bigint,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: User,
  ): Promise<MessageResponse> {
    const message = await this.chat.editMessage(
      channelId,
      messageId,
      user.id,
      dto.content,
    );

    return toMessageResponse(message, this.snowflakes);
  }

  /**
   * Deletes a message. Authors can retract their own messages; owners and
   * moderators can remove anyone's. Deletion is a soft delete: the row stays,
   * the content goes, and clients render "message deleted" in its place.
   *
   * `@RequireCapability('post')` — the weaker of the two capabilities. The
   * guard proves the caller may post in this channel; the service then
   * escalates to `delete_others` only when the caller is not the author.
   * This two-step check is deliberate: the guard cannot know which applies,
   * because it has not loaded the message.
   *
   * 204, no body: the caller asked for a side effect, not a representation.
   * Idempotent: deleting an already-deleted message returns 204 without
   * moving `deletedAt`.
   */
  @Delete(':messageId')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('post')
  @RateLimit('strict-mutation')
  @HttpCode(204)
  async remove(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Param('messageId', ParseSnowflakePipe) messageId: bigint,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.chat.deleteMessage(channelId, messageId, user.id);
  }

  /**
   * A channel's history, paging in either direction.
   *
   * `?before=` scrolls back, `?after=` catches a client up from the last id it
   * holds, and neither returns the newest page. The two are mutually
   * exclusive and the DTO rejects a request naming both.
   *
   * The `messages` array is always **oldest → newest**, whichever cursor was
   * sent — see `ChatService.getHistory`.
   *
   * `view`, not `post`: a member whose `post` an override revoked can still
   * read. A caller who cannot view gets a 404 rather than a 403, which is the
   * hiding rule rather than an inconsistency — see `RequireCapabilityGuard`.
   *
   * `read` is user-dimensioned, so unlike the send route this one needs no
   * channel id for its bucket.
   */
  @Get()
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('view')
  @RateLimit('read')
  async history(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Query() query: CursorPaginationDto,
  ): Promise<MessagePageResponse> {
    const page = await this.chat.getHistory(
      channelId,
      { before: query.before, after: query.after },
      query.limit,
    );

    return {
      messages: page.messages.map((message) =>
        toMessageResponse(message, this.snowflakes),
      ),
      hasMore: page.hasMore,
    };
  }
}
