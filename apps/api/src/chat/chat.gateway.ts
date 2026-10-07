import { Logger } from '@nestjs/common';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { AdministrationService } from '../administration/administration.service';
import { DomainError } from '../common/errors';
import { SnowflakeService } from '../common/snowflake.service';
import type { RateLimitContext } from '../rate-limiter/rate-limit-key';
import type { RateLimitPolicyName } from '../rate-limiter/rate-limit-policies';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';
import type {
  AuthenticatedServer,
  AuthenticatedSocket,
} from './chat.io-adapter';
import { ChatService } from './chat.service';
import { ChatStateStore } from './chat-state-store.interface';
import { DeleteAck, parseMessageDeleteFrame } from './message-delete.frame';
import { EditAck, parseMessageEditFrame } from './message-edit.frame';
import {
  MessageDeleteResponse,
  MessageResponse,
  toMessageResponse,
} from './message-response';
import { parseMessageSendFrame, SendAck } from './message-send.frame';
import { ackErrorFrom, ackKeyOf, AckError } from './socket-frame';

/**
 * The WebSocket transport: one multiplexed connection per client, no
 * per-channel or per-concern connections (chat-service.md section 2).
 *
 * On every connection the socket joins one room per channel the user may
 * view, across all of their servers — the map every later broadcast fires
 * into. The three mutation frames then ride that map: `message_send`
 * (#65), `message_edit` and `message_delete` (#66) each validate, spend
 * from a frame budget, dedupe, call the same `ChatService` method REST
 * calls, ack the sender, and broadcast to the room.
 *
 * The gateway stays thin, like a controller — validate, call the service,
 * shape the reply (repo-structure.md section 4; socket.io is the documented
 * exception to the port/adapter rule, not a licence to put logic here). The
 * things it owns that no service does: the room set (only it knows the
 * sockets exist) and the broadcast trio — the single place each of the three
 * events from chat-service.md section 3 is emitted.
 */
@WebSocketGateway()
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  /**
   * The socket.io server Nest binds here once the adapter has created it.
   * Every broadcast goes out through the trio below — never a direct
   * `this.server.to(...)` anywhere else — so "where do rooms fan out" has
   * exactly one answer.
   */
  @WebSocketServer()
  server!: AuthenticatedServer;

  constructor(
    private readonly administration: AdministrationService,
    private readonly chat: ChatService,
    private readonly state: ChatStateStore,
    private readonly rateLimiter: RateLimiterService,
    private readonly snowflakes: SnowflakeService,
  ) {}

  /**
   * Joins the socket to exactly the channels `GET /servers/:serverId/channels`
   * would list for this user, summed across every server they are in.
   *
   * Identity is already on `socket.data.user`: the handshake middleware set
   * it, and no frame can replace it. A failure here leaves the socket
   * connected but subscribed to nothing — a silent half-state — so the socket
   * is torn down instead and the client's reconnect recomputes from scratch.
   */
  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    try {
      const channels = await this.administration.listAccessibleChannels(
        socket.data.user.id,
      );

      for (const channel of channels) {
        await socket.join(channel.id.toString());
      }
    } catch (error) {
      this.logger.error(
        `room subscription failed for user ${socket.data.user.id}: ${String(error)}`,
      );
      socket.disconnect(true);
    }
  }

  /**
   * Emit site one of three: `message_create` to every socket in the
   * channel's room, sender included (chat-service.md section 4 — the
   * sender's UI updates from the direct ack, but its own broadcast is not
   * suppressed).
   *
   * Called from two places — this gateway's own handler after a socket send,
   * and the REST `POST` after the service write — because `ChatService` must
   * not know that rooms exist and the controller must not either: two write
   * paths were the whole point of routing both through `postMessage`, and a
   * second emit path would undo it.
   *
   * The payload is already shaped (`MessageResponse`): REST passes the very
   * object it is returning, so the Snowflake decoding happens once per
   * message, not twice.
   */
  broadcastCreate(channelId: bigint, message: MessageResponse): void {
    this.server.to(channelId.toString()).emit('message_create', message);
  }

  /**
   * Emit site two of three: `message_update` with the full edited message,
   * so a client renders the new text and the "(edited)" marker from
   * `editedAt` without re-fetching (chat-service.md section 3).
   *
   * Reached from the gateway's `message_edit` handler and the REST `PATCH`
   * alike — the controller hands back the very object it returns, same as
   * create.
   */
  broadcastUpdate(channelId: bigint, message: MessageResponse): void {
    this.server.to(channelId.toString()).emit('message_update', message);
  }

  /**
   * Emit site three of three: `message_delete` with the id and channel a
   * client patches by — never the content (chat-service.md section 3; the
   * payload type says why).
   *
   * Reached from the gateway's `message_delete` handler and the REST
   * `DELETE`. The controller has both ids on the route already, so it does
   * not need the service to hand a message back just to build this.
   */
  broadcastDelete(channelId: bigint, deletion: MessageDeleteResponse): void {
    this.server.to(channelId.toString()).emit('message_delete', deletion);
  }

  /**
   * A client sends a message (chat-service.md section 4), and gets a direct
   * ack through socket.io's emit acknowledgement — separate from the room
   * broadcast, scoped to this one event.
   *
   * The order is deliberate, cheapest-and-safest-first: **validate** the
   * frame (`MessageSendFrameDto` — the same content rules REST's body runs
   * through), then **`admit`** it (budget, `post`, room — one shared step),
   * then **recall** the idempotency key: a repeat inside the 30-second
   * window gets the original result — one ack, no second row, and **no
   * re-broadcast** (a judgment call: the room already saw that message, and
   * replaying it would duplicate every client's history for a client-side
   * retry). Finally **write** through `ChatService.postMessage` — the single
   * write path, shared with REST — **file** the result under the key,
   * **ack** the sender, and **broadcast**.
   *
   * Every failure on every step leaves the connection up and arrives as
   * `{ idempotencyKey?, error: { code, retryable } }`, so the client can
   * tell auto-retry (rate limited) from giving up (everything else).
   */
  @SubscribeMessage('message_send')
  async onMessageSend(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() raw: unknown,
    @Ack() ack?: (response: SendAck) => void,
  ): Promise<void> {
    // Read off the raw payload, because it must be echoable even when
    // validation is what fails and no frame exists.
    const idempotencyKey = ackKeyOf(raw);

    try {
      const frame = await parseMessageSendFrame(raw);

      const refusal = await this.admit(socket, frame.channelId, 'message-send');

      if (refusal !== null) {
        ack?.({ idempotencyKey: frame.idempotencyKey, error: refusal });
        return;
      }

      const filed = await this.state.recallSend(
        socket.data.user.id,
        frame.idempotencyKey,
      );

      if (filed !== null) {
        ack?.({
          idempotencyKey: frame.idempotencyKey,
          messageId: filed.messageId,
          createdAt: filed.createdAt,
        });
        return;
      }

      const message = await this.chat.postMessage(
        frame.channelId,
        socket.data.user.id,
        frame.content,
      );
      const response = toMessageResponse(message, this.snowflakes);

      await this.state.rememberSend(socket.data.user.id, frame.idempotencyKey, {
        messageId: response.id,
        createdAt: response.createdAt,
      });

      ack?.({
        idempotencyKey: frame.idempotencyKey,
        messageId: response.id,
        createdAt: response.createdAt,
      });
      this.broadcastCreate(frame.channelId, response);
    } catch (error) {
      // A domain refusal is an answered question, not a fault; anything else
      // is a bug and belongs in the log with its stack.
      if (!(error instanceof DomainError)) {
        this.logger.error(
          `message_send failed for user ${socket.data.user.id}: ${String(error)}`,
        );
      }

      ack?.({ idempotencyKey, error: ackErrorFrom(error) });
    }
  }

  /**
   * A client edits one of its own messages (#66). Same skeleton as
   * `message_send`, same ack protocol — but the mutation itself is not
   * reimplemented here: `ChatService.editMessage` is what #62 wrote, and it
   * owns the message-level rules (exists, belongs to this channel, not
   * deleted, author-only). The handler resolves only what a guard would
   * have, via `admit`.
   *
   * A deduped replay acks and does **not** re-broadcast, for the reason
   * above: re-running the edit would re-stamp `editedAt`, and re-emitting
   * would move every client's marker for a client-side retry.
   */
  @SubscribeMessage('message_edit')
  async onMessageEdit(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() raw: unknown,
    @Ack() ack?: (response: EditAck) => void,
  ): Promise<void> {
    const idempotencyKey = ackKeyOf(raw);

    try {
      const frame = await parseMessageEditFrame(raw);

      // `strict-mutation`, the same bucket REST's `PATCH` spends from:
      // switching transport cannot double a caller's allowance.
      const refusal = await this.admit(
        socket,
        frame.channelId,
        'strict-mutation',
      );

      if (refusal !== null) {
        ack?.({ idempotencyKey: frame.idempotencyKey, error: refusal });
        return;
      }

      const filed = await this.state.recallEdit(
        socket.data.user.id,
        frame.idempotencyKey,
      );

      if (filed !== null) {
        ack?.({
          idempotencyKey: frame.idempotencyKey,
          messageId: filed.messageId,
          editedAt: filed.editedAt,
        });
        return;
      }

      const message = await this.chat.editMessage(
        frame.channelId,
        frame.messageId,
        socket.data.user.id,
        frame.content,
      );
      const response = toMessageResponse(message, this.snowflakes);

      await this.state.rememberEdit(socket.data.user.id, frame.idempotencyKey, {
        messageId: response.id,
        editedAt: response.editedAt,
      });

      ack?.({
        idempotencyKey: frame.idempotencyKey,
        messageId: response.id,
        editedAt: response.editedAt,
      });
      this.broadcastUpdate(frame.channelId, response);
    } catch (error) {
      if (!(error instanceof DomainError)) {
        this.logger.error(
          `message_edit failed for user ${socket.data.user.id}: ${String(error)}`,
        );
      }

      ack?.({ idempotencyKey, error: ackErrorFrom(error) });
    }
  }

  /**
   * A client deletes a message (#66). Again the skeleton of `message_send`,
   * with `ChatService.deleteMessage` doing the work — including the two-step
   * check (#63): author-only without more, `delete_others` re-resolved
   * through the same `resolveCapability` the guard uses for anyone else.
   *
   * The ack and the broadcast carry the id only. The content was blanked by
   * the write itself; nothing here could leak it even by bug, because the
   * payload is built from the frame, after the service returned.
   *
   * A deduped replay acks and does not re-broadcast — the room was already
   * told once.
   */
  @SubscribeMessage('message_delete')
  async onMessageDelete(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() raw: unknown,
    @Ack() ack?: (response: DeleteAck) => void,
  ): Promise<void> {
    const idempotencyKey = ackKeyOf(raw);

    try {
      const frame = await parseMessageDeleteFrame(raw);

      const refusal = await this.admit(
        socket,
        frame.channelId,
        'strict-mutation',
      );

      if (refusal !== null) {
        ack?.({ idempotencyKey: frame.idempotencyKey, error: refusal });
        return;
      }

      const filed = await this.state.recallDelete(
        socket.data.user.id,
        frame.idempotencyKey,
      );

      if (filed !== null) {
        ack?.({
          idempotencyKey: frame.idempotencyKey,
          messageId: filed.messageId,
        });
        return;
      }

      await this.chat.deleteMessage(
        frame.channelId,
        frame.messageId,
        socket.data.user.id,
      );

      const messageId = frame.messageId.toString();

      await this.state.rememberDelete(
        socket.data.user.id,
        frame.idempotencyKey,
        {
          messageId,
        },
      );

      ack?.({ idempotencyKey: frame.idempotencyKey, messageId });
      this.broadcastDelete(frame.channelId, {
        id: messageId,
        channelId: frame.channelId.toString(),
      });
    } catch (error) {
      if (!(error instanceof DomainError)) {
        this.logger.error(
          `message_delete failed for user ${socket.data.user.id}: ${String(error)}`,
        );
      }

      ack?.({ idempotencyKey, error: ackErrorFrom(error) });
    }
  }

  /**
   * The steps every frame repeats, in the order #65 fixed them: spend the
   * budget for `policy`, resolve `post` for `(caller, channel)`, confirm the
   * socket actually holds the channel's room. Returns the `error` half of
   * the failure ack to send, or `null` when the frame may proceed.
   *
   * One home for the three, so `message_edit` and `message_delete` cannot
   * drift into a different order — and so #70 has the single escalation hook
   * it expects (`limitFrame`, one call per frame; rate-limiter.md section 6:
   * refusal is an ack, the connection stays up).
   *
   * `post`, not a per-frame capability: REST resolves `post` for both the
   * edit and the delete route, and the message-level rules (author-only
   * edit, the two-step delete check) stay in `ChatService` where #62 and #63
   * wrote them — this resolves the transport gap a guard would have covered,
   * nothing more. Not-joined is refused as `NOT_FOUND`, the same non-answer
   * the hiding rule gives: the socket's room set is its whole visible
   * world, and a 403 would say more than a 404 about a channel outside it.
   */
  private async admit(
    socket: AuthenticatedSocket,
    channelId: bigint,
    policy: RateLimitPolicyName,
  ): Promise<AckError | null> {
    const limitError = await this.limitFrame(policy, {
      ip: socket.data.ip,
      userId: socket.data.user.id,
      channelId,
    });

    if (limitError !== null) return limitError;

    await this.chat.requirePost(channelId, socket.data.user.id);

    if (!socket.rooms.has(channelId.toString())) {
      return { code: 'NOT_FOUND', retryable: false };
    }

    return null;
  }

  /**
   * The one place a per-frame budget is spent, and the one place a refusal
   * is shaped (#65) — so #70 has a single hook to escalate from (closing the
   * socket on repeated refusals) without re-deriving which policy applies.
   *
   * The connection stays up on refusal, per rate-limiter.md section 6: the
   * frame is dropped, the error rides the frame's own ack.
   *
   * Fails closed if the limiter itself is down, the same stance the REST
   * guard and the handshake take: refusing one message costs a retry;
   * admitting messages with no budget costs the budget.
   */
  private async limitFrame(
    policy: RateLimitPolicyName,
    context: RateLimitContext,
  ): Promise<AckError | null> {
    try {
      const decision = await this.rateLimiter.consume(policy, context);

      return decision.allowed
        ? null
        : { code: 'RATE_LIMITED', retryable: true };
    } catch (error) {
      this.logger.error(`${policy} frame limit failed: ${String(error)}`);
      return { code: 'RATE_LIMITED', retryable: true };
    }
  }
}
