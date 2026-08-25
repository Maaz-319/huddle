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
    expect(dto.cursor).toBeUndefined();
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

  it('turns a Snowflake cursor into a bigint', () => {
    const { dto, errors } = parse({
      limit: '10',
      cursor: '175928847299117063',
    });

    expect(errors).toHaveLength(0);
    expect(dto.cursor).toBe(175928847299117063n);
  });

  it.each([['not-a-snowflake'], ['-1'], ['12.5'], [1759288472991]])(
    'rejects a cursor of %p',
    (cursor) => {
      expect(failingProperties({ cursor })).toEqual(['cursor']);
    },
  );
});
