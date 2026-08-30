import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isInviteCode } from './invite-code';

/**
 * Validates a `:code` route parameter, rejecting anything not shaped like an
 * invite code with a 400.
 *
 * An invite code is not a Snowflake, so `ParseSnowflakePipe` does not apply
 * here. This exists so a garbage code costs no database query: a pipe runs
 * before the handler, so nothing reaches a repository.
 *
 * The shape check is `isInviteCode`, which lives beside the generator, so the
 * validator and the thing it validates can never drift apart.
 */
@Injectable()
export class ParseInviteCodePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !isInviteCode(value)) {
      throw new BadRequestException('Expected an invite code');
    }

    return value;
  }
}
