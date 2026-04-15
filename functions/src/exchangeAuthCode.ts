import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import axios from 'axios';

// Named Firestore database (see nodeMatcherBatch.ts for context).
const db = getFirestore('roadguard');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExchangeRequest {
  authorizationCode?: string;
  referrer?: 'DEFAULT' | 'SANDBOX' | 'UNLINK' | 'WITHDRAWAL_TERMS' | 'WITHDRAWAL_TOSS';
}

interface ExchangeResponse {
  token: string;
  userKey: string;
  expiresIn: number;
  referrer: string;
}

// Toss token exchange result (real-world shape; subset we consume).
// Real production requires mTLS with a client certificate registered in
// the AppsInToss console. See:
// https://developers-apps-in-toss.toss.im/docs/auth
interface TossTokenResponse {
  accessToken: string;
  refreshToken: string;
  userKey: string;
  expiresIn: number;
}

// ---------------------------------------------------------------------------
// JWT (HMAC-SHA256) — no external dep
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): { token: string; expiresIn: number } {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const fullPayload = { ...payload, iat: now, exp };

  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(fullPayload));
  const signingInput = `${h}.${p}`;
  const signature = base64url(
    createHmac('sha256', secret).update(signingInput).digest(),
  );
  return { token: `${signingInput}.${signature}`, expiresIn: ttlSeconds };
}

// ---------------------------------------------------------------------------
// Toss token exchange
// ---------------------------------------------------------------------------

// Real-world exchange: POST to Toss auth server with client cert (mTLS).
// We encapsulate the call so the mock / real switch is isolated.
async function exchangeWithToss(
  authorizationCode: string,
  clientId: string,
  clientSecret: string,
): Promise<TossTokenResponse> {
  // TODO(prod): register a client certificate in the AppsInToss console,
  // store it as a Secret Manager secret, and build an https.Agent with
  // { cert, key } before calling the Toss endpoint. Until that is wired
  // up, this call will fail and the caller falls back to the mock path.
  const res = await axios.post(
    'https://oauth2.cert.toss.im/token',
    {
      grant_type: 'authorization_code',
      code: authorizationCode,
      client_id: clientId,
      client_secret: clientSecret,
    },
    {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    },
  );
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
function mockUserKeyFrom(authorizationCode: string): string {
  const hash = createHash('sha256').update(authorizationCode).digest('hex');
  return `mock_${hash.slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Unlink / withdrawal handler
// ---------------------------------------------------------------------------

// When referrer is UNLINK / WITHDRAWAL_* the user is not exchanging an
// auth code — they are severing the integration. We zero out the user's
// tokens and mark the profile as unlinked. The Toss console should have
// this URL registered as the unlink callback.
async function handleUnlink(userKey: string, referrer: string): Promise<void> {
  await db
    .collection('users')
    .doc(userKey)
    .set(
      {
        unlinkedAt: admin.firestore.FieldValue.serverTimestamp(),
        unlinkReason: referrer,
      },
      { merge: true },
    );
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const exchangeAuthCode = onRequest(
  {
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
  },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'method-not-allowed' });
        return;
      }

      const body = (req.body ?? {}) as ExchangeRequest;
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

      let userKey: string;
      let mode: 'toss' | 'mock';

      if (clientId && clientSecret) {
        try {
          const tossRes = await exchangeWithToss(
            authorizationCode,
            clientId,
            clientSecret,
          );
          if (!tossRes.userKey) {
            throw new Error('Toss response missing userKey');
          }
          userKey = tossRes.userKey;
          mode = 'toss';
        } catch (err) {
          console.warn(
            '[exchangeAuthCode] Toss exchange failed, falling back to mock:',
            err instanceof Error ? err.message : err,
          );
          // Sandbox callers sometimes lack production mTLS credentials;
          // we honor that by degrading to a deterministic mock key
          // rather than 500-ing the whole login flow.
          userKey = mockUserKeyFrom(authorizationCode);
          mode = 'mock';
        }
      } else {
        userKey = mockUserKeyFrom(authorizationCode);
        mode = 'mock';
      }

      // -----------------------------------------------------------------
      // 2. Unlink / withdrawal short-circuit
      // -----------------------------------------------------------------
      if (
        referrer === 'UNLINK' ||
        referrer === 'WITHDRAWAL_TERMS' ||
        referrer === 'WITHDRAWAL_TOSS'
      ) {
        await handleUnlink(userKey, referrer);
        console.log(
          `[exchangeAuthCode] unlink processed for ${userKey} (${referrer})`,
        );
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
        .set(
          {
            userId: userKey,
            lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
            sessionNonce: randomBytes(8).toString('hex'),
            authMode: mode,
          },
          { merge: true },
        );

      // -----------------------------------------------------------------
      // 4. Issue app JWT (30 days). Intentionally omits Toss OAuth
      //    tokens — those stay server-side only.
      // -----------------------------------------------------------------
      const { token, expiresIn } = signJwt(
        { sub: userKey, mode },
        appJwtSecret,
        60 * 60 * 24 * 30, // 30 days
      );

      const response: ExchangeResponse = {
        token,
        userKey,
        expiresIn,
        referrer: referrer ?? 'DEFAULT',
      };
      res.json(response);
    } catch (err) {
      console.error('[exchangeAuthCode] unhandled error:', err);
      res.status(500).json({
        error: 'internal',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
