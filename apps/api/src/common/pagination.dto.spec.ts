import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CursorPaginationDto,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './pagination.dto';

function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(CursorPaginationDto, query, {
    enableImplicitConversion: false,
  });

  return { dto, errors: validateSync(dto) };
}

function failingProperties(query: Record<string, unknown>): string[] {
  return parse(query).errors.map((error) => error.property);
}

describe('CursorPaginationDto', () => {
  it('defaults to a page of 50 with no cursor', () => {
    const { dto, errors } = parse({});

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(dto.before).toBeUndefined();
    expect(dto.after).toBeUndefined();
  });

  it('converts the query string limit to a number', () => {
    const { dto, errors } = parse({ limit: '25' });

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(25);
  });

  it('accepts the maximum page size', () => {
    expect(failingProperties({ limit: String(MAX_PAGE_SIZE) })).toEqual([]);
  });

  it.each([['0'], ['-1'], [String(MAX_PAGE_SIZE + 1)], ['1.5'], ['abc'], ['']])(
    'rejects a limit of %p',
    (limit) => {
      expect(failingProperties({ limit })).toEqual(['limit']);
    },
  );

  it('turns a `before` cursor into a bigint', () => {
    const { dto, errors } = parse({
      limit: '10',
      before: '175928847299117063',
    });

    expect(errors).toHaveLength(0);
    expect(dto.before).toBe(175928847299117063n);
  });

  it('turns an `after` cursor into a bigint', () => {
    const { dto, errors } = parse({ after: '175928847299117063' });

    expect(errors).toHaveLength(0);
    expect(dto.after).toBe(175928847299117063n);
  });

  it('rejects both cursors together, and says they are exclusive', () => {
    // There is no sensible page that is both before X and after Y, and the
    // service must never be handed one to invent a precedence rule for.
    const { errors } = parse({
      before: '175928847299117063',
      after: '175928847299117064',
    });

    expect(errors.map((error) => error.property)).toEqual(['after']);
    expect(Object.values(errors[0]?.constraints ?? {})).toContain(
      'before and after are mutually exclusive',
    );
  });

  it('accepts either cursor on its own', () => {
    expect(failingProperties({ before: '175928847299117063' })).toEqual([]);
    expect(failingProperties({ after: '175928847299117063' })).toEqual([]);
  });

  it.each([['not-a-snowflake'], ['-1'], ['12.5'], [1759288472991]])(
    'rejects a `before` cursor of %p',
    (before) => {
      expect(failingProperties({ before })).toEqual(['before']);
    },
  );

  it.each([['not-a-snowflake'], ['-1'], ['12.5'], [1759288472991]])(
    'rejects an `after` cursor of %p',
    (after) => {
      expect(failingProperties({ after })).toEqual(['after']);
    },
  );
});
