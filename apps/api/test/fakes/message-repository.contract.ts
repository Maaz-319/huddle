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
    let serverId: bigint;
    let channelId: bigint;

    beforeEach(async () => {
      ({ messages, channels, servers } = await createRepositories());
      const { server } = await servers.createWithOwner(
        HUDDLE_HQ,
        MESSAGE_AUTHOR_ID,
      );
      serverId = server.id;
      const channel = await channels.create({
        serverId,
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

    describe('updateContent', () => {
      it('replaces the content and stamps editedAt', async () => {
        const created = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'original',
        });

        const before = Date.now();
        const updated = await messages.updateContent(created.id, 'edited');

        expect(updated.content).toBe('edited');
        expect(updated.editedAt).toBeInstanceOf(Date);
        expect(updated.editedAt!.getTime()).toBeGreaterThanOrEqual(before);

        // The row itself changed, not just the returned copy.
        const stored = await messages.findById(created.id);
        expect(stored?.content).toBe('edited');
        expect(stored?.editedAt).toEqual(updated.editedAt);
      });

      it('rejects a message id that does not exist', async () => {
        await expect(
          messages.updateContent(NO_SUCH_MESSAGE, 'gone'),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('softDelete', () => {
      it('sets isDeleted, stamps deletedAt, and blanks the content', async () => {
        const created = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'goodbye',
        });

        const before = Date.now();
        const deleted = await messages.softDelete(created.id);

        expect(deleted.isDeleted).toBe(true);
        expect(deleted.deletedAt).toBeInstanceOf(Date);
        expect(deleted.deletedAt!.getTime()).toBeGreaterThanOrEqual(before);
        expect(deleted.content).toBe('');

        const stored = await messages.findById(created.id);
        expect(stored?.isDeleted).toBe(true);
        expect(stored?.content).toBe('');
      });

      it('is idempotent — deleting twice does not move deletedAt', async () => {
        const created = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'twice',
        });

        const first = await messages.softDelete(created.id);
        const second = await messages.softDelete(created.id);

        expect(second.deletedAt).toEqual(first.deletedAt);
        expect(second.isDeleted).toBe(true);
      });

      it('rejects a message id that does not exist', async () => {
        await expect(
          messages.softDelete(NO_SUCH_MESSAGE),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    /** `count` messages in the fixture channel, oldest first. */
    async function seedMessages(count: number): Promise<bigint[]> {
      const ids: bigint[] = [];

      for (let index = 0; index < count; index += 1) {
        const message = await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: `message ${index}`,
        });
        ids.push(message.id);
      }

      return ids;
    }

    describe('findPageBefore', () => {
      it('returns the newest messages when there is no cursor', async () => {
        const ids = await seedMessages(5);

        const page = await messages.findPageBefore(channelId, null, 3);

        // Newest first, which is the order the index holds. The service is
        // what reverses it for the response.
        expect(page.map((message) => message.id)).toEqual([
          ids[4],
          ids[3],
          ids[2],
        ]);
      });

      it('returns only messages older than the cursor', async () => {
        const ids = await seedMessages(5);

        const page = await messages.findPageBefore(channelId, ids[2], 10);

        expect(page.map((message) => message.id)).toEqual([ids[1], ids[0]]);
      });

      it('excludes the cursor message itself', async () => {
        const ids = await seedMessages(3);

        const page = await messages.findPageBefore(channelId, ids[1], 10);

        expect(page.map((message) => message.id)).not.toContain(ids[1]);
      });

      it('caps the page at the limit', async () => {
        await seedMessages(10);

        const page = await messages.findPageBefore(channelId, null, 4);

        expect(page).toHaveLength(4);
      });

      it('returns an empty page past the oldest message', async () => {
        const ids = await seedMessages(3);

        const page = await messages.findPageBefore(channelId, ids[0], 10);

        expect(page).toEqual([]);
      });

      it('does not return messages from another channel', async () => {
        await seedMessages(3);
        const other = await channels.create({
          serverId,
          name: 'other',
          isPrivate: false,
        });
        await messages.create({
          channelId: other.id,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'elsewhere',
        });

        const page = await messages.findPageBefore(other.id, null, 10);

        expect(page).toHaveLength(1);
        expect(page[0]?.content).toBe('elsewhere');
      });

      it('is unaffected by messages inserted after the cursor was taken', async () => {
        // The reason the cursor is a Snowflake and not an offset: paging
        // backwards while the channel is live must not skip or repeat a row.
        const ids = await seedMessages(4);
        const first = await messages.findPageBefore(channelId, null, 2);

        await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'arrived mid-scroll',
        });

        const second = await messages.findPageBefore(
          channelId,
          first[first.length - 1]?.id ?? null,
          2,
        );

        expect(first.map((message) => message.id)).toEqual([ids[3], ids[2]]);
        expect(second.map((message) => message.id)).toEqual([ids[1], ids[0]]);
      });
    });

    describe('findPageAfter', () => {
      it('returns only messages newer than the cursor, oldest first', async () => {
        const ids = await seedMessages(5);

        const page = await messages.findPageAfter(channelId, ids[1], 10);

        expect(page.map((message) => message.id)).toEqual([
          ids[2],
          ids[3],
          ids[4],
        ]);
      });

      it('excludes the cursor message itself', async () => {
        const ids = await seedMessages(3);

        const page = await messages.findPageAfter(channelId, ids[0], 10);

        expect(page.map((message) => message.id)).not.toContain(ids[0]);
      });

      it('caps the page at the limit, taking the oldest of what is newer', async () => {
        const ids = await seedMessages(10);

        const page = await messages.findPageAfter(channelId, ids[0], 3);

        // The oldest three of the nine that follow, not the newest three:
        // catching up means resuming from the gap, not jumping to the end.
        expect(page.map((message) => message.id)).toEqual([
          ids[1],
          ids[2],
          ids[3],
        ]);
      });

      it('returns an empty page when the cursor is the newest message', async () => {
        const ids = await seedMessages(3);

        const page = await messages.findPageAfter(channelId, ids[2], 10);

        expect(page).toEqual([]);
      });

      it('does not return messages from another channel', async () => {
        const ids = await seedMessages(2);
        const other = await channels.create({
          serverId,
          name: 'other',
          isPrivate: false,
        });
        await messages.create({
          channelId: other.id,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'elsewhere',
        });

        const page = await messages.findPageAfter(channelId, ids[0], 10);

        expect(page.map((message) => message.content)).toEqual(['message 1']);
      });
    });
  });
}
