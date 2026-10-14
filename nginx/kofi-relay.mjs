// Ko-fi webhook -> GitHub repository_dispatch (runs next to nginx, see docker-compose.yml).
//
// Ko-fi sends the webhook as form data (data=<json>), GitHub only accepts JSON with a token
// in the header - this small server translates between them. Only the name, visibility and
// type are forwarded, never the amount, email or message.
//
// Environment:
//   GITHUB_TOKEN             fine-grained token for the website repo with "Contents: Read and write"
//   KOFI_VERIFICATION_TOKEN  required, rejects fake requests before they reach GitHub
//   GITHUB_REPO              default SpaceTheme/spacetheme-net
//
// Without Docker: node nginx/kofi-relay.mjs and in nginx
//   location = /api/kofi/webhook { proxy_pass http://127.0.0.1:8787; }

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const REPO = process.env.GITHUB_REPO || 'SpaceTheme/spacetheme-net';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const KOFI_TOKEN = process.env.KOFI_VERIFICATION_TOKEN || '';
const GITHUB_API = process.env.GITHUB_API || 'https://api.github.com';
const MAX_BODY = 64 * 1024;

function sameToken(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
            body += chunk;
            if (body.length > MAX_BODY) reject(new Error('Body too large'));
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function dispatch(data) {
    const res = await fetch(`${GITHUB_API}/repos/${REPO}/dispatches`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'SpaceTheme-Kofi-Relay',
            'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
            event_type: 'kofi-support',
            client_payload: {
                verification_token: data.verification_token,
                from_name: data.from_name,
                is_public: data.is_public,
                type: data.type,
                kofi_transaction_id: data.kofi_transaction_id
            }
        }),
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${await res.text()}`);
}

const server = http.createServer(async (req, res) => {
    const reply = (status, text) => {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(text);
    };
    if (req.method !== 'POST') return reply(405, 'Method not allowed');

    let data;
    try {
        data = JSON.parse(new URLSearchParams(await readBody(req)).get('data') || 'null');
    } catch {
        return reply(400, 'Bad request');
    }
    if (!GITHUB_TOKEN || !KOFI_TOKEN) {
        console.error('GITHUB_TOKEN or KOFI_VERIFICATION_TOKEN is not set, webhook ignored');
        return reply(503, 'Not configured');
    }
    if (!data?.verification_token) return reply(400, 'Missing data');
    if (!sameToken(data.verification_token, KOFI_TOKEN)) return reply(401, 'Invalid verification token');

    try {
        await dispatch(data);
        console.log(`Forwarded ${data.type || 'support'} from ${data.is_public === false ? 'a private supporter' : data.from_name}`);
        reply(200, 'OK');
    } catch (e) {
        console.error(e.message);
        reply(502, 'Could not reach GitHub');
    }
});

server.listen(PORT, () => console.log(`Ko-fi relay listening on :${PORT}, forwarding to ${REPO}`));
