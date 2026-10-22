import type { SnowflakeService } from '../common/snowflake.service';
import type { MessageWithAuthor } from './chat.service';

/**
 * The shape every message route and every `message_create` /
 * `message_update` broadcast carries — a `Message` with its author hydrated
 * (ChatService composes the two ports; see chat.service.ts), ids serialised
 * per AGENTS.md section 4.
 *
 * `createdAt` is present despite there being no such column: it is decoded
 * from the Snowflake id (docs/architecture/data-model.md section 3), so the
 * absence of the column is invisible to a client.
 *
 * `content` is nullable here while `Message.content` is not. A soft-deleted
 * message is still returned — history renders a "message deleted" placeholder
 * in its place (PRD FR-18/FR-19) — but its text never is.
 */
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

/**
 * Lives in its own file rather than on `MessageController` because two
 * callers now shape the same payload: the REST routes and the gateway's
 * `message_create` broadcast (#65). A controller-to-controller import here
 * would close a cycle the moment the controller injects the gateway, and a
 * second copy of this mapper is how the REST and socket payloads would drift.
 *
 * Exported for the same reason `toChannelResponse` is: #61's history route
 * returns arrays of this shape.
 */
export function toMessageResponse(
  message: MessageWithAuthor,
  snowflakes: SnowflakeService,
): MessageResponse {
  return {
    id: message.id.toString(),
    channelId: message.channelId.toString(),
    authorId: message.authorId.toString(),
    author: {
      id: message.author.id.toString(),
      username: message.author.username,
      avatarUrl: message.author.avatarUrl,
    },
    // Nulled rather than merely relied upon to be blank. #63 blanks the
    // stored value at delete time; this makes the response correct whether or
    // not that has happened, and keeps it correct for rows written before it.
    content: message.isDeleted ? null : message.content,
    createdAt: snowflakes.timestampFrom(message.id).toISOString(),
    editedAt: message.editedAt === null ? null : message.editedAt.toISOString(),
    isDeleted: message.isDeleted,
  };
}

/**
 * The shape of a `message_delete` broadcast (#66): everything a client needs
 * to swap the row for its "message deleted" placeholder, and nothing more.
 *
 * Two fields, deliberately: the id to find the row by, and the channel —
 * one socket carries every room the user is in, so a client has no other way
 * to tell which channel the removal came from. The deleted content is not
 * here for the same reason it is nulled above: the row is blanked at delete
 * time (#63), and this payload is built after that write, never before.
 */
export interface MessageDeleteResponse {
  id: string;
  channelId: string;
}

/** One page of history, as the history route returns it. */
export interface MessagePageResponse {
  messages: MessageResponse[];
  hasMore: boolean;
}
