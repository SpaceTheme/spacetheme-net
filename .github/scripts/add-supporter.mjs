// Adds a Ko-fi supporter to data/supporter.json, called by .github/workflows/kofi-supporter.yml.
// Only the name and an avatar are stored - never the amount, email or message.
//
// KOFI_PAYLOAD: client_payload of the repository_dispatch event (sent by nginx/kofi-relay.mjs)
// KOFI_VERIFICATION_TOKEN: the verification token from the Ko-fi webhook settings (GitHub secret)

import { readFile, writeFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';

const FILE = new URL('../../data/supporter.json', import.meta.url);
// Ko-fi doesn't send profile pictures, so new supporters get one of Ko-fi's default avatars
const AVATAR_COUNT = 15;
// "Send test" in the Ko-fi webhook settings uses this transaction id
const TEST_TRANSACTION = /^0{8}-1{4}-2{4}-3{4}-4{12}$/;

function sameToken(a, b) {
    const x = Buffer.from(String(a ?? ''));
    const y = Buffer.from(String(b ?? ''));
    return x.length === y.length && timingSafeEqual(x, y);
}

function done(message, code = 0) {
    console.log(message);
    process.exit(code);
}

const payload = JSON.parse(process.env.KOFI_PAYLOAD || '{}');
const expected = process.env.KOFI_VERIFICATION_TOKEN;

if (!expected) done('The KOFI_VERIFICATION_TOKEN secret is missing.', 1);
if (!sameToken(payload.verification_token, expected)) done('Invalid verification token, request ignored.', 1);
if (TEST_TRANSACTION.test(payload.kofi_transaction_id || '')) done('Ko-fi test webhook received, everything works. Nothing was added.');
if (payload.is_public === false || payload.is_public === 'false') done('Private support, not added to the public list.');

// Plain text only, no html or control characters
const name = String(payload.from_name || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f<>"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
if (!name) done('Supporter has no name, nothing added.');

const data = JSON.parse(await readFile(FILE, 'utf8'));
if (data.users.some(user => user.name.toLowerCase() === name.toLowerCase())) {
    done(`${name} is already in the supporter list.`);
}

const avatar = createHash('sha1').update(name.toLowerCase()).digest()[0] % AVATAR_COUNT;
data.users.push({ name, image: `https://ko-fi.com/img/anon${avatar}.png` });
await writeFile(FILE, JSON.stringify(data, null, 4) + '\n');
console.log(`Added ${name} to the supporter list.`);
