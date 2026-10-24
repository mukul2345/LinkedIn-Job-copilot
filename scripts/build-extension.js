#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'extension');
const output = path.join(ROOT, 'dist', 'extension');
const excludedNames = new Set(['.DS_Store', 'tests', '__tests__', '.env', '.env.local']);

fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.cpSync(source, output, {
  recursive: true,
  filter(sourcePath) {
    const relative = path.relative(source, sourcePath);
    return !relative.split(path.sep).some(segment =>
      excludedNames.has(segment) || /secret|credential/i.test(segment)
    );
  },
});

// Gmail tracking is optional. Inject OAuth metadata only into the release
// artifact when the deploy environment supplies a valid public client ID.
const googleClientId = process.env.GOOGLE_CLIENT_ID;
if (googleClientId) {
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) {
    console.error('GOOGLE_CLIENT_ID must be a valid Google OAuth client ID.');
    process.exit(1);
  }
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.permissions = [...new Set([...(manifest.permissions || []), 'identity'])];
  manifest.host_permissions = [...new Set([
    ...(manifest.host_permissions || []),
    'https://www.googleapis.com/*',
  ])];
  manifest.oauth2 = {
    client_id: googleClientId,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const validation = spawnSync(process.execPath, [
  path.join(__dirname, 'validate-extension.js'),
  output,
], { stdio: 'inherit' });
if (validation.status !== 0) process.exit(validation.status || 1);

const forbidden = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filePath);
    else if (entry.name === '.DS_Store' || /\.test\.js$/.test(entry.name)) forbidden.push(filePath);
  }
}
walk(output);
if (forbidden.length) {
  console.error(`Forbidden build files: ${forbidden.join(', ')}`);
  process.exit(1);
}
console.log(`Unpacked extension built at ${output}`);
