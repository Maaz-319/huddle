import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';

/** Body for `POST /servers/:serverId/transfer-ownership`. */
export class TransferOwnershipDto {
  @IsSnowflake()
  @TransformSnowflake()
  toUserId!: bigint;
}
