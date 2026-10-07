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
import { MessageResponse, toMessageResponse } from './message-response';
import { parseMessageSendFrame, SendAck } from './message-send.frame';
import { ackErrorFrom, ackKeyOf, AckError } from './socket-frame';

/**
 * The WebSocket transport: one multiplexed connection per client, no
 * per-channel or per-concern connections (chat-service.md section 2).
 *
 * On every connection the socket joins one room per channel the user may
 * view, across all of their servers — the map every later broadcast fires
 * into. From #65 the gateway also handles `message_send`: validate, spend
 * from the frame budget, resolve `post`, dedupe, write, ack the sender, and
 * broadcast to the room.
 *
 * The gateway stays thin, like a controller — validate, call the service,
 * shape the reply (repo-structure.md section 4; socket.io is the documented
 * exception to the port/adapter rule, not a licence to put logic here). The
 * two things it owns that no service does: the room set (only it knows the
 * sockets exist) and the single emit site `broadcast`.
 */
@WebSocketGateway()
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  /**
   * The socket.io server Nest binds here once the adapter has created it.
   * Every broadcast goes out through `broadcast` below — never a direct
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
   * The one emit site: `message_create` to every socket in the channel's
   * room, sender included (chat-service.md section 4 — the sender's UI
   * updates from the direct ack, but its own broadcast is not suppressed).
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
  broadcast(channelId: bigint, message: MessageResponse): void {
    this.server.to(channelId.toString()).emit('message_create', message);
  }

  /**
   * A client sends a message (chat-service.md section 4), and gets a direct
   * ack through socket.io's emit acknowledgement — separate from the room
   * broadcast, scoped to this one event.
   *
   * The order is deliberate, each step cheapest-and-safest-first:
   *
   * 1. **Validate** the frame (`MessageSendFrameDto` — the same content
   *    rules REST's body runs through), so a malformed frame is refused
   *    before it can reach Redis or Postgres.
   * 2. **Spend the `message-send` budget** — the same channel-dimensioned
   *    bucket the REST route uses, so switching transport cannot double a
   *    caller's allowance. Refusal is an ack, not a disconnect
   *    (rate-limiter.md section 6).
   * 3. **Resolve `post`** for `(caller, channel)`. Nest guards do not run
   *    around gateway handlers, so this calls the same `resolveCapability`
   *    path the HTTP guard uses — a client that never rendered a Send button
   *    is still refused server-side (PRD NFR-5).
   * 4. **Check the room**: a frame naming a channel this socket is not
   *    joined to is refused. Not-joined is refused as `NOT_FOUND`, the same
   *    non-answer the hiding rule gives — the socket's room set is its whole
   *    visible world, and a 403 would say more than a 404 about a channel
   *    outside it. The refusal is not an authorization failure: the owner
   *    whose brand-new channel predates a reconnect hits it too, and is
   *    expected to refresh.
   * 5. **Recall** the idempotency key: a repeat inside the 30-second window
   *    gets the original result — one ack, no second row, and **no
   *    re-broadcast** (a judgment call: the room already saw that message,
   *    and replaying it would duplicate every client's history for a
   *    client-side retry).
   * 6. **Write** through `ChatService.postMessage` — the single write path,
   *    shared with REST — then **file** the result under the key, **ack**
   *    the sender, and **broadcast**.
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

      const limitError = await this.limitFrame('message-send', {
        ip: socket.data.ip,
        userId: socket.data.user.id,
        channelId: frame.channelId,
      });

      if (limitError !== null) {
        ack?.({ idempotencyKey: frame.idempotencyKey, error: limitError });
        return;
      }

      await this.chat.requirePost(frame.channelId, socket.data.user.id);

      if (!socket.rooms.has(frame.channelId.toString())) {
        ack?.({
          idempotencyKey: frame.idempotencyKey,
          error: { code: 'NOT_FOUND', retryable: false },
        });
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
      this.broadcast(frame.channelId, response);
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
