import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MESSAGE_CONTENT_MAX, SendMessageDto } from './send-message.dto';

function parse(body: Record<string, unknown>) {
  const dto = plainToInstance(SendMessageDto, body, {
    enableImplicitConversion: false,
  });

  return { dto, errors: validateSync(dto) };
}

function failingProperties(body: Record<string, unknown>): string[] {
  return parse(body).errors.map((error) => error.property);
}

describe('SendMessageDto', () => {
  it('accepts ordinary content and leaves it alone', () => {
    const { dto, errors } = parse({ content: 'hello there' });

    expect(errors).toHaveLength(0);
    expect(dto.content).toBe('hello there');
  });

  it('trims leading and trailing whitespace before storage', () => {
    const { dto, errors } = parse({ content: '  hello there\n' });

    expect(errors).toHaveLength(0);
    expect(dto.content).toBe('hello there');
  });

  it('rejects empty content', () => {
    expect(failingProperties({ content: '' })).toEqual(['content']);
  });

  it('rejects whitespace-only content', () => {
    // A separate case from the empty one on purpose: it is the trim that
    // makes this fail, and a single lumped "invalid input" test would still
    // pass if the trim were removed.
    expect(failingProperties({ content: '   \t\n  ' })).toEqual(['content']);
  });

  it('rejects content over the character cap', () => {
    expect(
      failingProperties({ content: 'a'.repeat(MESSAGE_CONTENT_MAX + 1) }),
    ).toEqual(['content']);
  });

  it('accepts content exactly at the cap', () => {
    const { dto, errors } = parse({ content: 'a'.repeat(MESSAGE_CONTENT_MAX) });

    expect(errors).toHaveLength(0);
    expect(dto.content).toHaveLength(MESSAGE_CONTENT_MAX);
  });

  it('measures the cap after trimming, not before', () => {
    // Whitespace padding must not be able to push otherwise-valid content
    // over the limit — the doc says the cap is on the message, and the
    // padding is not part of it.
    const { dto, errors } = parse({
      content: `   ${'a'.repeat(MESSAGE_CONTENT_MAX)}   `,
    });

    expect(errors).toHaveLength(0);
    expect(dto.content).toHaveLength(MESSAGE_CONTENT_MAX);
  });

  it('rejects a non-string body field', () => {
    expect(failingProperties({ content: 42 })).toEqual(['content']);
  });

  it('stores content inert, without escaping or transforming it', () => {
    // The server never interprets content as HTML or Markdown
    // (chat-service.md section 3). Escaping here would store `&lt;` where a
    // person typed `<`, and the client escapes at render time anyway.
    const raw = '<script>alert(1)</script> **not bold**';
    const { dto, errors } = parse({ content: raw });

    expect(errors).toHaveLength(0);
    expect(dto.content).toBe(raw);
  });
});
