import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import { NAME_LENGTH } from './create-server.dto';
import { Server } from './server-repository.interface';

const CHANNEL_CREATION_POLICIES: Server['channelCreationPolicy'][] = [
  'owner_only',
  'everyone',
  'mods_only',
];

/** Body for `PATCH /servers/:serverId`. Every field is optional. */
export class UpdateServerDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(...NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  iconUrl?: string;

  @IsOptional()
  @IsIn(CHANNEL_CREATION_POLICIES)
  channelCreationPolicy?: Server['channelCreationPolicy'];

  @IsOptional()
  @IsBoolean()
  memberInviteToggle?: boolean;
}
