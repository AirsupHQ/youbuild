#!/usr/bin/env node
// Rebuilds src/vendor/anthropic-sdk.mjs, the official Anthropic SDK in one browser ES module, from
// the version in package.json. The extension loads without a build step, so the bundle is committed;
// run this to check it or to update it, then diff.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youbuild-sdk-')), 'entry.mjs');
fs.writeFileSync(entry, "export { default, Anthropic, APIError, AuthenticationError, RateLimitError, PermissionDeniedError, BadRequestError, NotFoundError, InternalServerError, APIConnectionError } from '@anthropic-ai/sdk';\n");
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120', 'firefox121'],
  legalComments: 'eof',
  nodePaths: [path.join(ROOT, 'node_modules')],
  outfile: path.join(ROOT, 'src', 'vendor', 'anthropic-sdk.mjs'),
});
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@anthropic-ai', 'sdk', 'package.json'), 'utf8')).version;
console.log('src/vendor/anthropic-sdk.mjs from @anthropic-ai/sdk ' + version);
