import { EventEmitter } from 'events';
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
