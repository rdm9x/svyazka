#!/usr/bin/env node
// Подписать SHA256SUMS.txt релиза ключом Ed25519 (для svyazka update). Запускается в GitHub Actions:
//   RELEASE_SIGNING_KEY=<PEM> node cli/sign-release.mjs dist/SHA256SUMS.txt   → dist/SHA256SUMS.txt.sig (base64)
// Секретный ключ хранится только в Связке автора и в секрете RELEASE_SIGNING_KEY; открытый — cli/release-key.pub.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
const pem = process.env.RELEASE_SIGNING_KEY;
if (!file || !pem) { console.error('usage: RELEASE_SIGNING_KEY=… node cli/sign-release.mjs SHA256SUMS.txt'); process.exit(1); }
const data = fs.readFileSync(file);
const sig = crypto.sign(null, data, crypto.createPrivateKey(pem));
const pub = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-key.pub'), 'utf8');
if (!crypto.verify(null, data, pub, sig)) { console.error('Ключ подписи не совпадает с cli/release-key.pub'); process.exit(1); }
fs.writeFileSync(file + '.sig', sig.toString('base64') + '\n');
console.log('signed', path.basename(file));
