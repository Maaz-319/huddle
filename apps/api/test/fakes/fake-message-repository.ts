import { NotFoundError } from '../../src/common/errors';
import {
  CreateMessageInput,
  Message,
  MessageRepository,
} from '../../src/chat/message-repository.interface';
import { FakeAdministrationStore } from './fake-administration-store';

/** Snowflake-shaped, i.e. too large for a JS number, so ids look real. */
const FIRST_ID = 900000000000000001n;

/**
 * In-memory `MessageRepository`, for unit tests of the services that depend
 * on the port.
 *
 * `extends MessageRepository` rather than duck-typing it, same reasoning as
 * `FakeChannelRepository`'s own doc: a method added to the port then breaks
 * compilation here.
 *
 * It is handed a `FakeAdministrationStore` purely so it can refuse a message
 * in a channel that does not exist. Real Postgres refuses that with a foreign
 * key; a fake with no channels at all would let the contract's "channel is
 * gone" case pass for the wrong reason.
 */
export class FakeMessageRepository extends MessageRepository {
  private readonly messages = new Map<bigint, Message>();
  private nextId = FIRST_ID;

  constructor(private readonly store: FakeAdministrationStore) {
    super();
  }

  create(input: CreateMessageInput): Promise<Message> {
    if (!this.store.channels.has(input.channelId)) {
      return Promise.reject(
        new NotFoundError('Channel not found', {
          channelId: input.channelId.toString(),
        }),
      );
    }

    const message: Message = {
      id: this.nextId++,
      editedAt: null,
      isDeleted: false,
      deletedAt: null,
      ...input,
    };
    this.messages.set(message.id, message);

    return Promise.resolve({ ...message });
  }

  findById(id: bigint): Promise<Message | null> {
    const message = this.messages.get(id);

    return Promise.resolve(message === undefined ? null : { ...message });
  }

  findPageBefore(
    channelId: bigint,
    before: bigint | null,
    limit: number,
  ): Promise<Message[]> {
    const page = this.inChannel(channelId)
      .filter((message) => before === null || message.id < before)
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, limit);

    return Promise.resolve(page);
  }

  findPageAfter(
    channelId: bigint,
    after: bigint,
    limit: number,
  ): Promise<Message[]> {
    const page = this.inChannel(channelId)
      .filter((message) => message.id > after)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit);

    return Promise.resolve(page);
  }

  /** Copies, so a caller mutating a returned message cannot reach the store. */
  private inChannel(channelId: bigint): Message[] {
    return [...this.messages.values()]
      .filter((message) => message.channelId === channelId)
      .map((message) => ({ ...message }));
  }
}
