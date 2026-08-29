import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `≤300 chars` per docs/architecture/data-model.md section 4.1. */
const MAX_BIO_LENGTH = 300;

/** Body for `PATCH /auth/me` — the only user-editable profile field. */
export class UpdateBioDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BIO_LENGTH)
  bio?: string;
}
