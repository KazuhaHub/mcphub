import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { injectBaseHref, readSpaShell, spaShellHandler } from '../../src/utils/frontendShell.js';

const shell =
  '<!DOCTYPE html><html><head><meta charset="UTF-8"><script type="module" src="./assets/index.js"></script></head><body><div id="root"></div></body></html>';

describe('injectBaseHref', () => {
  it('puts the app root base first in <head>', () => {
    expect(injectBaseHref(shell, '')).toContain('<head><base href="/"><meta charset="UTF-8">');
  });

  it('uses the base path', () => {
    expect(injectBaseHref(shell, '/hub')).toContain('<head><base href="/hub/">');
  });

  it('escapes the base path and injects only once', () => {
    const html = injectBaseHref('<head lang="x"></head><head></head>', '/a"b$&');
    expect(html).toBe('<head lang="x"><base href="/a&quot;b$&amp;/"></head><head></head>');
  });

  it('leaves a document without <head> unchanged', () => {
    expect(injectBaseHref('<html>shell</html>', '/hub')).toBe('<html>shell</html>');
  });
});

describe('readSpaShell', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-'));
    fs.writeFileSync(path.join(dir, 'index.html'), shell);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads index.html with the base injected', () => {
    expect(readSpaShell(dir, '/hub')).toContain('<base href="/hub/">');
  });

  it('returns null without a readable index.html', () => {
    expect(readSpaShell(path.join(dir, 'missing'), '')).toBeNull();
  });
});

describe('spaShellHandler', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-route-'));
    fs.writeFileSync(path.join(dir, 'index.html'), shell);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const build = (basePath: string) => {
    const app = express();
    app.use(basePath, express.static(dir));
    app.get(`${basePath}/*`, spaShellHandler(dir, basePath));
    return app;
  };

  it.each([
    ['', '/services/ubc-personal', '/'],
    ['', '/market/some-server', '/'],
    ['/hub', '/hub/services/ubc-personal', '/hub/'],
  ])('serves nested routes with the app root as base (%s%s)', async (basePath, url, href) => {
    const response = await request(build(basePath)).get(url).expect(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.text).toContain(`<head><base href="${href}">`);
  });

  it('falls back to the plain file when the shell cannot be read', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-empty-'));
    try {
      const app = express();
      app.get('/*', spaShellHandler(empty, ''));
      await request(app).get('/services/x').expect(404);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
