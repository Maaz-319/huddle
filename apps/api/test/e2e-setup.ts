import { EventEmitter } from 'events';
import request from 'supertest';
import { patchBigIntSerialization } from '../src/common/bigint-serialization';

/**
 * Jest setupFiles for the e2e suite. main.ts patches BigInt serialisation
 * before the app is created, and an e2e spec builds the app from AppModule
 * without ever running main.ts — so without this, any response carrying a
 * Snowflake would throw a TypeError here but not in production.
 */
patchBigIntSerialization();

// Increase max listeners to avoid MaxListenersExceededWarning from supertest/socket.io
// Multiple test files create socket.io clients; each adds connect listeners to MockHttpSocket
EventEmitter.defaultMaxListeners = 100;

// E2E HTTP clients represent the configured web app. Keep their default
// Origin aligned with WEB_ORIGIN; security-specific cases can still use an
// isolated guard test to supply a mismatched or missing origin.
// The original method is called with the current Test instance via .call below.
// eslint-disable-next-line @typescript-eslint/unbound-method -- this binding is preserved explicitly with .call(this)
const originalEnd = request.Test.prototype.end;
request.Test.prototype.end = function (
  this: request.Test,
  callback?: request.CallbackHandler,
): request.Test {
  const omitOrigin = this.get('X-Huddle-E2E-Omit-Origin') === 'true';
  this.unset('X-Huddle-E2E-Omit-Origin');
  if (!this.get('Origin') && !omitOrigin) {
    this.set('Origin', 'http://localhost:5173');
  }
  return originalEnd.call(this, callback);
};
