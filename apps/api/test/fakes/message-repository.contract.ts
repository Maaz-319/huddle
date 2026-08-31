import { MessageRepository } from '../../src/chat/message-repository.interface';
import { ChannelRepository } from '../../src/administration/channel-repository.interface';
import {
  CreateServerInput,
  ServerRepository,
} from '../../src/administration/server-repository.interface';
import { NotFoundError } from '../../src/common/errors';

const HUDDLE_HQ: CreateServerInput = {
  name: 'Huddle HQ',
  iconUrl: null,
  channelCreationPolicy: 'everyone',
  memberInviteToggle: true,
};

/**
 * The users these cases post as. The Prisma integration spec seeds real `User`
 * rows for both before each case, since unlike the fakes, real Postgres
 * enforces `Message.authorId`'s foreign key.
 */
export const MESSAGE_AUTHOR_ID = 340000000000000001n;
export const MESSAGE_OTHER_AUTHOR_ID = 340000000000000002n;

/** A channel id no row holds — for the "the channel went away" case. */
const NO_SUCH_CHANNEL = 999000000000000005n;

/** A message id no row holds. */
const NO_SUCH_MESSAGE = 999000000000000006n;

/**
 * Three ports, because a `Message` cannot exist on its own: it needs a real
 * `Channel`, which needs a real `Server`.
 */
export interface MessageRepositoryFixture {
  messages: MessageRepository;
  channels: ChannelRepository;
  servers: ServerRepository;
}

/** Builds an empty set of repositories for one test case. */
export type MessageRepositoryFactory = () => Promise<MessageRepositoryFixture>;

/**
 * The behaviour every `MessageRepository` must have, run against both
 * `FakeMessageRepository` and `PrismaMessageRepository` — see
 * `user-repository.contract.ts` for why this shared-suite shape exists.
 */
export function describeMessageRepositoryContract(
  label: string,
  createRepositories: MessageRepositoryFactory,
): void {
  describe(`MessageRepository contract (${label})`, () => {
    let messages: MessageRepository;
    let channels: ChannelRepository;
    let servers: ServerRepository;
    let channelId: bigint;

    beforeEach(async () => {
      ({ messages, channels, servers } = await createRepositories());
      const { server } = await servers.createWithOwner(
        HUDDLE_HQ,
        MESSAGE_AUTHOR_ID,
      );
      const channel = await channels.create({
        serverId: server.id,
        name: 'general',
        isPrivate: false,
      });
      channelId = channel.id;
    });

    describe('create', () => {
      it('stores a message and mints its id', async () => {
        const message = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'hello',
        });

        expect(message).toMatchObject({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'hello',
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
        });
        expect(typeof message.id).toBe('bigint');
      });

      it('mints ids that increase, so they order by creation', async () => {
        // Not merely "different": the id *is* the pagination cursor
        // (chat-service.md section 5), so a later message sorting before an
        // earlier one would silently corrupt every page boundary.
        const first = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'first',
        });
        const second = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'second',
        });

        expect(second.id > first.id).toBe(true);
      });

      it('stores content verbatim, without trimming it', async () => {
        // Trimming belongs to `SendMessageDto`, and doing it in two places is
        // how the two versions of the rule drift apart.
        const message = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: '  spaced  ',
        });

        expect(message.content).toBe('  spaced  ');
      });

      it('keeps two authors distinct in the same channel', async () => {
        const mine = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'mine',
        });
        const theirs = await messages.create({
          channelId,
          authorId: MESSAGE_OTHER_AUTHOR_ID,
          content: 'theirs',
        });

        expect(mine.authorId).toBe(MESSAGE_AUTHOR_ID);
        expect(theirs.authorId).toBe(MESSAGE_OTHER_AUTHOR_ID);
      });

      it('rejects a channel nobody holds with NotFoundError', async () => {
        // The real adapter reaches this through a foreign key violation: the
        // channel can be deleted between the guard's read and this write.
        await expect(
          messages.create({
            channelId: NO_SUCH_CHANNEL,
            authorId: MESSAGE_AUTHOR_ID,
            content: 'into the void',
          }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('findById', () => {
      it('finds a message that was created', async () => {
        const created = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'hello',
        });

        await expect(messages.findById(created.id)).resolves.toEqual(created);
      });

      it('returns null for an id nobody holds', async () => {
        await expect(messages.findById(NO_SUCH_MESSAGE)).resolves.toBeNull();
      });
    });
  });
}
