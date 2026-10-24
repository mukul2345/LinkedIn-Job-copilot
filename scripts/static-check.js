#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['extension', 'functions', 'scripts', 'tests'];
const excluded = new Set(['node_modules', 'coverage', 'dist', '.git']);
const failures = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath);
    else if (entry.name.endsWith('.js')) checkJavaScript(entryPath);
  }
}

function checkJavaScript(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  try {
    new vm.Script(source, { filename: filePath });
  } catch (error) {
    failures.push(`${path.relative(ROOT, filePath)}: ${error.message}`);
  }
  if (filePath !== __filename && /arguments\.callee/.test(source)) failures.push(`${path.relative(ROOT, filePath)}: arguments.callee is forbidden`);
}

SCAN_ROOTS.map(name => path.join(ROOT, name)).filter(fs.existsSync).forEach(walk);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Static JavaScript checks passed.');
