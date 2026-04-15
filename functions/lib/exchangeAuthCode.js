"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchangeAuthCode = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const admin = __importStar(require("firebase-admin"));
const node_crypto_1 = require("node:crypto");
const axios_1 = __importDefault(require("axios"));
// Named Firestore database (see nodeMatcherBatch.ts for context).
const db = (0, firestore_1.getFirestore)('roadguard');
// ---------------------------------------------------------------------------
// JWT (HMAC-SHA256) — no external dep
// ---------------------------------------------------------------------------
function base64url(input) {
    const buf = typeof input === 'string' ? Buffer.from(input) : input;
    return buf
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}
function signJwt(payload, secret, ttlSeconds) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const fullPayload = { ...payload, iat: now, exp };
    const h = base64url(JSON.stringify(header));
    const p = base64url(JSON.stringify(fullPayload));
    const signingInput = `${h}.${p}`;
    const signature = base64url((0, node_crypto_1.createHmac)('sha256', secret).update(signingInput).digest());
    return { token: `${signingInput}.${signature}`, expiresIn: ttlSeconds };
}
// ---------------------------------------------------------------------------
// Toss token exchange
// ---------------------------------------------------------------------------
// Real-world exchange: POST to Toss auth server with client cert (mTLS).
// We encapsulate the call so the mock / real switch is isolated.
async function exchangeWithToss(authorizationCode, clientId, clientSecret) {
    // TODO(prod): register a client certificate in the AppsInToss console,
    // store it as a Secret Manager secret, and build an https.Agent with
    // { cert, key } before calling the Toss endpoint. Until that is wired
    // up, this call will fail and the caller falls back to the mock path.
    const res = await axios_1.default.post('https://oauth2.cert.toss.im/token', {
        grant_type: 'authorization_code',
        code: authorizationCode,
        client_id: clientId,
        client_secret: clientSecret,
    }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
    });
    const data = res.data;
    return {
        accessToken: data.access_token ?? data.accessToken,
        refreshToken: data.refresh_token ?? data.refreshToken,
        userKey: data.user_key ?? data.userKey,
        expiresIn: Number(data.expires_in ?? data.expiresIn ?? 0),
    };
}
// Deterministic mock userKey — same authorizationCode always yields the
// same userKey so repeated logins in sandbox stay stable across
// redeploys.
function mockUserKeyFrom(authorizationCode) {
    const hash = (0, node_crypto_1.createHash)('sha256').update(authorizationCode).digest('hex');
    return `mock_${hash.slice(0, 24)}`;
}
// ---------------------------------------------------------------------------
// Unlink / withdrawal handler
// ---------------------------------------------------------------------------
// When referrer is UNLINK / WITHDRAWAL_* the user is not exchanging an
// auth code — they are severing the integration. We zero out the user's
// tokens and mark the profile as unlinked. The Toss console should have
// this URL registered as the unlink callback.
async function handleUnlink(userKey, referrer) {
    await db
        .collection('users')
        .doc(userKey)
        .set({
        unlinkedAt: admin.firestore.FieldValue.serverTimestamp(),
        unlinkReason: referrer,
    }, { merge: true });
}
// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
exports.exchangeAuthCode = (0, https_1.onRequest)({
    region: 'asia-northeast3',
    timeoutSeconds: 30,
    memory: '256MiB',
    cors: true,
    invoker: 'public',
    // Only APP_JWT_SECRET is declared here because TOSS_CLIENT_ID and
    // TOSS_CLIENT_SECRET are not yet provisioned (mTLS integration is a
    // pre-production task). Firebase rejects the whole deploy if it
    // can't validate every listed secret, so we add those back to this
    // array at the same time we register them in Secret Manager.
    secrets: ['APP_JWT_SECRET'],
}, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'method-not-allowed' });
            return;
        }
        const body = (req.body ?? {});
        const { authorizationCode, referrer } = body;
        if (!authorizationCode || typeof authorizationCode !== 'string') {
            res
                .status(400)
                .json({ error: 'invalid-argument', message: 'authorizationCode required' });
            return;
        }
        // App JWT secret is required even in mock mode so we always issue
        // signed tokens — a missing secret is a deployment bug, not a
        // recoverable condition.
        const appJwtSecret = process.env.APP_JWT_SECRET;
        if (!appJwtSecret) {
            console.error('[exchangeAuthCode] APP_JWT_SECRET is not configured');
            res.status(500).json({
                error: 'internal',
                message: 'server is missing APP_JWT_SECRET',
            });
            return;
        }
        // -----------------------------------------------------------------
        // 1. Exchange with Toss (or mock when mTLS creds are missing)
        // -----------------------------------------------------------------
        const clientId = process.env.TOSS_CLIENT_ID;
        const clientSecret = process.env.TOSS_CLIENT_SECRET;
        let userKey;
        let mode;
        if (clientId && clientSecret) {
            try {
                const tossRes = await exchangeWithToss(authorizationCode, clientId, clientSecret);
                if (!tossRes.userKey) {
                    throw new Error('Toss response missing userKey');
                }
                userKey = tossRes.userKey;
                mode = 'toss';
            }
            catch (err) {
                console.warn('[exchangeAuthCode] Toss exchange failed, falling back to mock:', err instanceof Error ? err.message : err);
                // Sandbox callers sometimes lack production mTLS credentials;
                // we honor that by degrading to a deterministic mock key
                // rather than 500-ing the whole login flow.
                userKey = mockUserKeyFrom(authorizationCode);
                mode = 'mock';
            }
        }
        else {
            userKey = mockUserKeyFrom(authorizationCode);
            mode = 'mock';
        }
        // -----------------------------------------------------------------
        // 2. Unlink / withdrawal short-circuit
        // -----------------------------------------------------------------
        if (referrer === 'UNLINK' ||
            referrer === 'WITHDRAWAL_TERMS' ||
            referrer === 'WITHDRAWAL_TOSS') {
            await handleUnlink(userKey, referrer);
            console.log(`[exchangeAuthCode] unlink processed for ${userKey} (${referrer})`);
            res.json({
                token: '',
                userKey,
                expiresIn: 0,
                referrer,
                unlinked: true,
            });
            return;
        }
        // -----------------------------------------------------------------
        // 3. Upsert minimal user document (onboarding may fill more later)
        // -----------------------------------------------------------------
        await db
            .collection('users')
            .doc(userKey)
            .set({
            userId: userKey,
            lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
            sessionNonce: (0, node_crypto_1.randomBytes)(8).toString('hex'),
            authMode: mode,
        }, { merge: true });
        // -----------------------------------------------------------------
        // 4. Issue app JWT (30 days). Intentionally omits Toss OAuth
        //    tokens — those stay server-side only.
        // -----------------------------------------------------------------
        const { token, expiresIn } = signJwt({ sub: userKey, mode }, appJwtSecret, 60 * 60 * 24 * 30);
        const response = {
            token,
            userKey,
            expiresIn,
            referrer: referrer ?? 'DEFAULT',
        };
        res.json(response);
    }
    catch (err) {
        console.error('[exchangeAuthCode] unhandled error:', err);
        res.status(500).json({
            error: 'internal',
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
//# sourceMappingURL=exchangeAuthCode.js.map