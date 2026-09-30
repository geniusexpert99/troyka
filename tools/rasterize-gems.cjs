'use strict';
// Optional art tool. Requires sharp; the checked-in PNG runs without dependencies.
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
sharp(path.join(root, 'art/gems.svg'))
  .png({ compressionLevel: 9 })
  .toFile(path.join(root, 'dist/assets/gems.png'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
