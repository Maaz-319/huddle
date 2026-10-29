import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Capability } from '../administration/channel-override-repository.interface';

export interface ChannelPermissionRequest extends Request {
  effectiveChannelCapabilities?: Capability[];
}

/** Capabilities resolved by `RequireCapabilityGuard` for this request. */
export const CurrentChannelCapabilities = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Capability[] => {
    const request = context
      .switchToHttp()
      .getRequest<ChannelPermissionRequest>();
    return request.effectiveChannelCapabilities ?? [];
  },
);
