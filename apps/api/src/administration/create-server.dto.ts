import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * No doc specifies a length limit for `Server.name` — confirmed with the
 * user as 1–100 chars, trimmed, consistent with `Message.content`'s
 * documented `≤2048 chars` being the only other string-cap precedent in this
 * schema.
 */
export const NAME_LENGTH = [1, 100] as const;

/** Body for `POST /servers`. */
export class CreateServerDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(...NAME_LENGTH)
  name!: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;
}
