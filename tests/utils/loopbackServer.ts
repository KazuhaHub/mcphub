import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

/**
 * Serves `app` on 127.0.0.1 at a free port and returns its base URL.
 *
 * `supertest(app)` listens on port 0 of every interface (`::`) and then connects to 127.0.0.1.
 * On macOS another process (another Jest worker, a dev server) may hold the same port number
 * bound to 127.0.0.1 specifically, and the request lands there: a 404 or someone else's 401.
 * Binding 127.0.0.1 ourselves makes the port ours on the address we connect to.
 */
export const listenOnLoopback = async (
  app: Express,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server: Server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
};
