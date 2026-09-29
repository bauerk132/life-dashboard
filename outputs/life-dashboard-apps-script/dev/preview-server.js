#!/usr/bin/env node
/**
 * dev/preview-server.js
 *
 * DEV-ONLY static preview server for the Phase 2 client, used only for
 * local Browser-pane verification (plan step B5). Never pushed to Apps
 * Script: .claspignore is a whitelist (`**\/**` then explicit `!name`
 * un-ignores) and dev/ is never one of the un-ignored entries.
 *
 * What this does, and nothing else:
 *   1. Reads Index.html, Styles.html, and JavaScript.html from the app
 *      root (one directory up from this file) on every request, so edits
 *      show up on a plain browser refresh with no server restart.
 *   2. Replaces the two Apps Script include scriptlets
 *      (<?!= include('Styles'); ?> / <?!= include('JavaScript'); ?>) with
 *      the raw file contents. This is the only templating it performs --
 *      it does not implement the rest of HtmlService's scriptlet syntax,
 *      because Index.html uses only these two calls today.
 *   3. Injects dev/mock-google-script-run.js just before the inlined
 *      JavaScript.html content, so window.google.script.run already
 *      exists before the app's own script runs.
 *
 * Uses only Node's built-in http/fs/path modules -- nothing to install,
 * matching this project's "nothing gets installed" constraint. Binds to
 * 127.0.0.1 only, never 0.0.0.0: this serves local source files and must
 * not be reachable from the network.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4173;
const HOST = '127.0.0.1';

function readAppFile(name) {
  return fs.readFileSync(path.join(APP_ROOT, name), 'utf8');
}

function readMock() {
  return fs.readFileSync(path.join(__dirname, 'mock-google-script-run.js'), 'utf8');
}

function renderIndex() {
  const indexHtml = readAppFile('Index.html');
  const stylesHtml = readAppFile('Styles.html');
  const javascriptHtml = readAppFile('JavaScript.html');
  const mockScript = '<script>\n' + readMock() + '\n</script>\n';

  // Replacer *functions* are used (not strings) because String.replace
  // treats a string replacement specially: sequences like $&, $`, $', $$
  // are interpreted as replacement patterns. JavaScript.html's own source
  // contains "$'" (e.g. `return '$' + val.toFixed(2);` in formatUsd),
  // which as a plain string replacement corrupts the assembled page.
  return indexHtml
    .replace("<?!= include('Styles'); ?>", () => stylesHtml)
    .replace("<?!= include('JavaScript'); ?>", () => mockScript + javascriptHtml);
}

const server = http.createServer((req, res) => {
  // Single-page preview: every request renders the same assembled
  // document, so scenario query params on the page URL (?calendar=fail,
  // etc.) reach the mock via window.location.search regardless of path.
  try {
    const html = renderIndex();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Preview server error: ' + (err && err.message ? err.message : String(err)));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Life Dashboard dev preview: http://${HOST}:${PORT}/`);
});
