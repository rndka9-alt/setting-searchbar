/**
 * Self-auth module for setting-searchbar.
 *
 * Reads the risuai password from the shared save volume, generates an
 * ES256 keypair, and registers it via POST /api/login.
 * After registration, issueToken() produces JWTs that risuai accepts
 * — so the Playwright crawler can skip the password dialog entirely.
 *
 * Pattern borrowed from with-sqlite's auth module.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { UPSTREAM, RISUAI_SAVE_MOUNT } from './config.js';

const TAG = '[ssb:auth]';
const PASSWORD_PATH = `${RISUAI_SAVE_MOUNT}/__password`;
const JWT_LIFETIME_S = 300;

let privateKey: crypto.webcrypto.CryptoKey | null = null;
let publicKeyJwk: crypto.webcrypto.JsonWebKey | null = null;
let registered = false;

export async function initAuth(): Promise<void> {
  let password: string;
  try {
    password = fs.readFileSync(PASSWORD_PATH, 'utf-8').trim();
  } catch {
    console.warn(`${TAG} cannot read password file (${PASSWORD_PATH}) — self-auth disabled`);
    return;
  }

  if (!password) {
    console.warn(`${TAG} password file is empty — self-auth disabled`);
    return;
  }

  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = kp.privateKey;
  publicKeyJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);

  await registerWithRetry(password);
}

async function registerOnce(password: string): Promise<boolean> {
  try {
    const resp = await fetch(`${UPSTREAM.origin}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, publicKey: publicKeyJwk }),
    });

    if (resp.ok) {
      registered = true;
      console.log(`${TAG} registered with risuai`);
      return true;
    }

    const errBody = await resp.text();
    console.warn(`${TAG} registration failed: ${resp.status} ${errBody}`);
  } catch (err) {
    console.warn(`${TAG} registration error (risuai not ready?):`, err instanceof Error ? err.message : err);
  }
  return false;
}

async function registerWithRetry(password: string): Promise<void> {
  const MAX_RETRIES = 10;
  const RETRY_DELAY_MS = 3000;

  for (let i = 0; i < MAX_RETRIES; i++) {
    if (await registerOnce(password)) return;
    console.warn(`${TAG} retry ${i + 1}/${MAX_RETRIES}`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  console.error(`${TAG} exhausted retries — self-auth disabled`);
}

/** Issue a JWT signed with our registered keypair. */
export async function issueToken(): Promise<string | null> {
  if (!registered || !privateKey || !publicKeyJwk) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = { iat: now, exp: now + JWT_LIFETIME_S, pub: publicKeyJwk };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    Buffer.from(signingInput),
  );

  return `${headerB64}.${payloadB64}.${Buffer.from(signature).toString('base64url')}`;
}

export function isAuthReady(): boolean {
  return registered;
}
