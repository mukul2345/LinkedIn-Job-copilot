#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const extensionRoot = path.resolve(process.argv[2] || path.join(ROOT, 'extension'));
const failures = [];
const manifestPath = path.join(extensionRoot, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function requireFile(relativePath, label) {
  if (!fs.existsSync(path.join(extensionRoot, relativePath))) failures.push(`${label}: ${relativePath}`);
}

requireFile(manifest.background.service_worker, 'Missing service worker');
requireFile(manifest.action.default_popup, 'Missing popup');
Object.values(manifest.icons || {}).forEach(file => requireFile(file, 'Missing icon'));
for (const contentScript of manifest.content_scripts || []) {
  [...(contentScript.js || []), ...(contentScript.css || [])].forEach(file => requireFile(file, 'Missing content asset'));
}

const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filePath);
    else if (/\.(js|json|html)$/.test(entry.name)) sourceFiles.push(filePath);
  }
}
walk(extensionRoot);
const combined = sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
if (/<GOOGLE_CLIENT_ID>|YOUR[_-]?(API[_-]?KEY|SECRET)|sk-[A-Za-z0-9]{16,}/i.test(combined)) failures.push('Placeholder or secret-like value found');
if (/id=["']linkedin(?:Email|Password)["']|btoa\s*\([^)]*(?:email|password)/i.test(combined)) failures.push('Legacy LinkedIn credential collection remains');
if (manifest.oauth2 && /[<>]|GOOGLE_CLIENT_ID/i.test(manifest.oauth2.client_id || '')) failures.push('Invalid OAuth placeholder');
if (manifest.content_security_policy?.extension_pages?.includes('unsafe-eval')) failures.push('Unsafe extension CSP');

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Extension validation passed (${manifest.version}).`);
module.exports = { manifest, extensionRoot };
