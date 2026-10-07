import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  SERVER_ACCESS_CHANGED,
  USER_ACCESS_CHANGED,
} from '../administration/access-events';
import type {
  ServerAccessChanged,
  UserAccessChanged,
} from '../administration/access-events';
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
import {
  CatchUpAck,
  CatchUpChannelResponse,
  CATCH_UP_LIMIT,
  parseCatchUpFrame,
} from './catch-up.frame';
import { DeleteAck, parseMessageDeleteFrame } from './message-delete.frame';
import { EditAck, parseMessageEditFrame } from './message-edit.frame';
import {
  MessageDeleteResponse,
  MessageResponse,
  toMessageResponse,
} from './message-response';
import { parseMessageSendFrame, SendAck } from './message-send.frame';
import { ackErrorFrom, ackKeyOf, AckError } from './socket-frame';
import { parseTypingFrame, TypingAck, TypingBroadcast } from './typing.frame';

/**
 * The WebSocket transport: one multiplexed connection per client, no
 * per-channel or per-concern connections (chat-service.md section 2).
 *
 * On every connection the socket joins one room per channel the user may
 * view, across all of their servers — the map every later broadcast fires
 * into. The three mutation frames then ride that map: `message_send`
 * (#65), `message_edit` and `message_delete` (#66) each validate, spend
 * from a frame budget, dedupe, call the same `ChatService` method REST
 * calls, ack the sender, and broadcast to the room. `typing` (#67) rides
 * the same rooms with its own sequence — authorize, debounce, budget,
 * broadcast — because its budget is the ceiling *behind* the debounce,
 * not the first gate. `catch_up` (#68) is the one read in the set:
 * validate, spend from `read`, resolve visibility in bulk, fetch what the
 * client missed through the same forward query REST's `?after=` uses, and
 * ack — never a broadcast, since only the sender is behind.
 *
 * The gateway stays thin, like a controller — validate, call the service,
 * shape the reply (repo-structure.md section 4; socket.io is the documented
 * exception to the port/adapter rule, not a licence to put logic here). The
 * things it owns that no service does: the room set (only it knows the
 * sockets exist) and the broadcast sites — the single place each of the
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
   * Live access changes scoped to one user (#69): seated into a private
   * channel, removed from one, promoted, demoted — Administration emitted,
   * and every connection that user holds is reconciled against
   * `listAccessibleChannels`, the same pass `handleConnection` builds rooms
   * from.
   *
   * Recomputed rather than acted on from the event payload: a demotion or a
   * server-wide change moves channels no write named, and the issue's rule
   * for this half is explicit — guessing who is affected is how a case gets
   * missed. The reconcile runs both directions, so the grant half (a seat
   * appearing mid-session) joins the room and pushes `channel_added` in the
   * same pass that a revocation leaves and pushes `channel_removed`.
   *
   * A failure here is logged, not thrown: this runs detached from any
   * request (the emitter does not await listeners), and the fallback for a
   * reconcile that never lands is the next connection recomputing rooms
   * anyway.
   */
  @OnEvent(USER_ACCESS_CHANGED)
  async onUserAccessChanged(payload: UserAccessChanged): Promise<void> {
    this.logger.debug(
      `access changed for user ${payload.userId.toString()}${payload.channelId === undefined ? '' : ` (channel ${payload.channelId.toString()})`}`,
    );

    await this.reconcileUser(payload.userId);
  }

  /**
   * Live access changes that can move many users at once (#69): a channel
   * flipped private, deleted, an override added or removed, a server
   * deleted, ownership transferred.
   *
   * The payload names the server for the log line and nothing else: the
   * gateway holds no membership data with which to scope the work to that
   * server's members, deriving the set from the payloads would be exactly
   * the guessing the issue warns against, and at single-instance scale
   * (NFR-10) recomputing the connected set is a handful of indexed reads
   * per user. The pass is idempotent — users nothing affected reconcile to
   * zero changes.
   */
  @OnEvent(SERVER_ACCESS_CHANGED)
  async onServerAccessChanged(payload: ServerAccessChanged): Promise<void> {
    this.logger.debug(
      `access changed in server ${payload.serverId.toString()}${payload.channelId === undefined ? '' : ` (channel ${payload.channelId.toString()})`}`,
    );

    const userIds = new Set<bigint>();
    for (const socket of this.server.sockets.sockets.values()) {
      userIds.add(socket.data.user.id);
    }

    await Promise.all([...userIds].map((userId) => this.reconcileUser(userId)));
  }

  /**
   * One user's live reconciliation: diff every connection they hold against
   * their current accessible set — `socket.leave` plus a `channel_removed`
   * for each room they lost, `socket.join` plus a `channel_added` for each
   * they gained. Never a disconnect: losing a channel must not cost the
   * connection (chat-service.md section 2).
   *
   * Order within a socket matters — leave first — so a room is empty before
   * the client is told it is gone, and a join lands before its announcement.
   * Both payloads are bare `{ channelId }`: the event, not the message
   * stream, and the client does the local bookkeeping.
   *
   * Swallows and logs rather than throwing — see `onUserAccessChanged`.
   */
  private async reconcileUser(userId: bigint): Promise<void> {
    try {
      const connections = [...this.server.sockets.sockets.values()].filter(
        (socket) => socket.data.user.id === userId,
      );

      // No live connection: nothing to reconcile now, and the next
      // connection computes its rooms fresh anyway.
      if (connections.length === 0) return;

      const accessible =
        await this.administration.listAccessibleChannels(userId);
      const accessibleIds = new Set(
        accessible.map((channel) => channel.id.toString()),
      );

      for (const socket of connections) {
        for (const room of [...socket.rooms]) {
          if (room === socket.id || accessibleIds.has(room)) continue;
          await socket.leave(room);
          this.reachSocket(socket.id).emit('channel_removed', {
            channelId: room,
          });
        }

        for (const channelId of accessibleIds) {
          if (socket.rooms.has(channelId)) continue;
          await socket.join(channelId);
          this.reachSocket(socket.id).emit('channel_added', { channelId });
        }
      }
    } catch (error) {
      this.logger.error(
        `access reconcile failed for user ${userId.toString()}: ${String(error)}`,
      );
    }
  }

  /**
   * The single-socket emit path, used only by `reconcileUser`. It goes
   * through `server.to(socket.id)` rather than `socket.emit(...)` because
   * both are typed against `Record<string, never>` for client events —
   * the map is deliberately empty (chat.io-adapter) — and a direct emit
   * against it resolves the payload to `never`, refusing every argument,
   * while the broadcast operator decorates that same map into something
   * callable, which is how every existing emit in this class compiles.
   * Every socket sits in a room named for its own id (the `room ===
   * socket.id` skip above exists because of it), so targeting that room
   * reaches exactly one connection — no wider than `socket.emit`, and
   * without widening the type contract of every broadcast in the class.
   */
  private reachSocket(socketId: string): ReturnType<AuthenticatedServer['to']> {
    return this.server.to(socketId);
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
   * A client is composing (#67, chat-service.md section 7): every *other*
   * socket in the channel's room hears `typing` at most once per debounce
   * window per user — the sender itself is excluded (`socket.to`, not
   * `io.to`).
   *
   * The sequence differs from `admit`'s on purpose, and the order is the
   * design decision of #67:
   *
   * 1. **validate** the frame (one field — and its whitelist is what
   *    rejects a forged `userId` before anything reads it);
   * 2. **authorize** — `post` (someone who cannot write is not composing)
   *    plus room membership, via the shared `authorize` step;
   * 3. **debounce** — `markTyping` opens the window on `true`; a `false`
   *    is dropped *silently*: no ack, no error frame, nothing the rate
   *    limiter ever sees, because dropping is the normal case while
   *    somebody types, not a violation;
   * 4. **budget** — only frames the debounce let through spend from
   *    `typing`, so the bucket is the ceiling *behind* the debounce: a
   *    fast typist never sees it, a flood of watchers-in-the-making does;
   * 5. **broadcast** to the room minus the sender.
   *
   * No success ack, by design — see `TypingAck`; refusals ride the ack as
   * the same failure shape every other frame sends. And there is no
   * stopped-typing event: see `typing.frame.ts` for why that is deliberate.
   */
  @SubscribeMessage('typing')
  async onTyping(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() raw: unknown,
    @Ack() ack?: (response: TypingAck) => void,
  ): Promise<void> {
    try {
      const frame = await parseTypingFrame(raw);

      const refusal = await this.authorize(socket, frame.channelId);

      if (refusal !== null) {
        ack?.({ error: refusal });
        return;
      }

      const fresh = await this.state.markTyping(
        socket.data.user.id,
        frame.channelId,
      );

      if (!fresh) return;

      const limitRefusal = await this.limitFrame('typing', {
        ip: socket.data.ip,
        userId: socket.data.user.id,
        channelId: frame.channelId,
      });

      if (limitRefusal !== null) {
        ack?.({ error: limitRefusal });
        return;
      }

      const broadcast: TypingBroadcast = {
        channelId: frame.channelId.toString(),
        userId: socket.data.user.id.toString(),
      };
      socket.to(frame.channelId.toString()).emit('typing', broadcast);
    } catch (error) {
      if (!(error instanceof DomainError)) {
        this.logger.error(
          `typing failed for user ${socket.data.user.id}: ${String(error)}`,
        );
      }

      ack?.({ error: ackErrorFrom(error) });
    }
  }

  /**
   * A reconnecting client asks for everything it missed (#68,
   * chat-service.md section 6): one frame naming every channel it holds
   * state for, one ack carrying the messages each channel is missing after
   * the id the client last saw — no gap, however long it was away, and no
   * re-downloading pages it already has.
   *
   * The sequence, cheapest-first:
   *
   * 1. **validate** — the channels array and both ids per entry, bounded at
   *    `CATCH_UP_MAX_CHANNELS` so one reconnect cannot hand the handler an
   *    unbounded work set;
   * 2. **budget** — one `read` token for the whole frame, not one per
   *    channel: the reason a client sends one frame instead of thirty is
   *    that a reconnect should cost one spend;
   * 3. **resolve visibility in bulk** — `listAccessibleChannels`, the same
   *    `resolveCapability` pass that built this socket's rooms on
   *    connection, run fresh here rather than trusted from the room set.
   *    A requested channel outside it is **omitted, not errored**: it never
   *    existed, or access was revoked while the client was away, and an
   *    error of any kind would confirm existence to a caller who can no
   *    longer see the channel — an existence oracle;
   * 4. **fetch** — `ChatService.getHistory` with an `after` cursor, the
   *    forward query #61 wrote for REST's `?after=` (no new SQL), capped at
   *    `CATCH_UP_LIMIT`. `hasMore` becomes `truncated`, so the client knows
   *    to fall back to a fresh history load rather than render a
   *    gap-containing list;
   * 5. **ack** this one socket — never a broadcast: only this client is
   *    behind, and nobody else asked for anything.
   *
   * No idempotency key by design: this is a read with nothing to dedupe.
   * The reply is pure state, so a retried frame simply asks again, and the
   * failure half is the same shape every other frame sends.
   */
  @SubscribeMessage('catch_up')
  async onCatchUp(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() raw: unknown,
    @Ack() ack?: (response: CatchUpAck) => void,
  ): Promise<void> {
    try {
      const frame = await parseCatchUpFrame(raw);

      const refusal = await this.limitFrame('read', {
        ip: socket.data.ip,
        userId: socket.data.user.id,
      });

      if (refusal !== null) {
        ack?.({ error: refusal });
        return;
      }

      const visible = await this.administration.listAccessibleChannels(
        socket.data.user.id,
      );
      const visibleIds = new Set(visible.map((channel) => channel.id));

      const channels: CatchUpChannelResponse[] = [];

      for (const request of frame.channels) {
        // Outside the visible set — never existed or revoked while away —
        // omitted with no error at all, for the oracle reason above.
        if (!visibleIds.has(request.channelId)) continue;

        const page = await this.chat.getHistory(
          request.channelId,
          { after: request.afterMessageId },
          CATCH_UP_LIMIT,
        );

        channels.push({
          channelId: request.channelId.toString(),
          messages: page.messages.map((message) =>
            toMessageResponse(message, this.snowflakes),
          ),
          truncated: page.hasMore,
        });
      }

      ack?.({ channels });
    } catch (error) {
      if (!(error instanceof DomainError)) {
        this.logger.error(
          `catch_up failed for user ${socket.data.user.id}: ${String(error)}`,
        );
      }

      ack?.({ error: ackErrorFrom(error) });
    }
  }

  /**
   * The steps every frame repeats, in the order #65 fixed them: spend the
   * budget for `policy`, then authorize — returning the `error` half of
   * the failure ack to send, or `null` when the frame may proceed.
   *
   * One home for the three, so `message_edit` and `message_delete` cannot
   * drift into a different order — and so #70 has the single escalation hook
   * it expects (`limitFrame`, one call per frame; rate-limiter.md section 6:
   * refusal is an ack, the connection stays up).
   *
   * `typing` is the one frame that does *not* call `admit`: its debounce
   * has to run before the budget (see `onTyping`), so it sequences
   * `authorize` and `limitFrame` itself — with `authorize` below shared by
   * both orders so the authorization rules still have one home.
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

    return this.authorize(socket, channelId);
  }

  /**
   * The authorization half of a frame: resolve `post` for
   * `(caller, channel)`, then confirm the socket actually holds the
   * channel's room.
   *
   * `post`, not a per-frame capability: REST resolves `post` for both the
   * edit and the delete route, and the message-level rules (author-only
   * edit, the two-step delete check) stay in `ChatService` where #62 and #63
   * wrote them — this resolves the transport gap a guard would have covered,
   * nothing more. Not-joined is refused as `NOT_FOUND`, the same non-answer
   * the hiding rule gives: the socket's room set is its whole visible
   * world, and a 403 would say more than a 404 about a channel outside it.
   *
   * A `requirePost` refusal escapes as the `DomainError` the handler's catch
   * maps through `ackErrorFrom` — exactly what the guard would have answered
   * on REST.
   */
  private async authorize(
    socket: AuthenticatedSocket,
    channelId: bigint,
  ): Promise<AckError | null> {
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
