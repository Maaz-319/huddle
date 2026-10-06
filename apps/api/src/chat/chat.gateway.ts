import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { AdministrationService } from '../administration/administration.service';
import type {
  AuthenticatedServer,
  AuthenticatedSocket,
} from './chat.io-adapter';

/**
 * The WebSocket transport (#64): one multiplexed connection per client, no
 * per-channel or per-concern connections (chat-service.md section 2).
 *
 * Nothing is sent over the socket in this ticket — this gateway computes
 * *where* events will later fan out: on every connection the socket joins one
 * room per channel the user may view, across all of their servers. The
 * accessible set is recomputed fresh each time and never cached across
 * reconnects, which is half of how live permission changes stay correct; the
 * other half is the live revocation path (#69).
 *
 * The gateway stays thin, like a controller — validate, call the service,
 * shape the reply (repo-structure.md section 4; socket.io is the documented
 * exception to the port/adapter rule, not a licence to put logic here).
 */
@WebSocketGateway()
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  /**
   * The socket.io server Nest binds here once the adapter has created it.
   * Nothing emits through it in this ticket — #65 broadcasts fan out through
   * `this.server.to(room)` — and the e2e suite reads it to observe which
   * rooms a connection actually joined.
   */
  @WebSocketServer()
  server!: AuthenticatedServer;

  constructor(private readonly administration: AdministrationService) {}

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
}
