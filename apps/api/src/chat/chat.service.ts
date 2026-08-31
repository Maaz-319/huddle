import { Injectable } from '@nestjs/common';
import { Message, MessageRepository } from './message-repository.interface';

/**
 * Message create, edit, delete and history — the business logic behind both
 * the REST routes here and, from Phase 8, the socket.io gateway. The gateway
 * calls these same methods rather than reimplementing them, which is the
 * reason this is a service and not logic inlined into the controller.
 *
 * It deliberately holds no permission checks. `RequireCapabilityGuard` has
 * already resolved the caller's effective capability in the channel by the
 * time a method here runs, including the owner short-circuit, the
 * private-channel hiding rule, and channel overrides. A second check here
 * would be a second copy of a rule that already has one home.
 */
@Injectable()
export class ChatService {
  constructor(private readonly messages: MessageRepository) {}

  /**
   * Stores a message. `content` is already trimmed and length-checked by
   * `SendMessageDto`; the id and creation time both come from the Snowflake
   * the repository mints.
   */
  sendMessage(
    channelId: bigint,
    authorId: bigint,
    content: string,
  ): Promise<Message> {
    return this.messages.create({ channelId, authorId, content });
  }
}
