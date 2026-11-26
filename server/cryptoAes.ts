import crypto from 'node:crypto';
import CryptoJS from 'crypto-js';
import type { EphemeralCredentials } from '../shared/models';

const AES_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';

export function randomAesString(length: number): string {
  const alphabetLen = AES_CHARS.length; // 48
  const maxUnbiased = Math.floor(256 / alphabetLen) * alphabetLen; // 240
  let out = '';
  while (out.length < length) {
    const needed = length - out.length;
    const bytes = crypto.randomBytes(Math.max(16, needed * 2));
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      const b = bytes[i];
      if (b < maxUnbiased) {
        out += AES_CHARS.charAt(b % alphabetLen);
      }
    }
  }
  return out;
}

export function generateSecureHex(byteLength: number): string {
  return crypto.randomBytes(byteLength).toString('hex').toUpperCase();
}

export function encryptGdouPassword(password: string, salt: string): string {
  const trimmedSalt = (salt ?? '').trim();
  if (!trimmedSalt || trimmedSalt.length < 16) {
    throw new Error('未获取到有效的海大认证加密盐值 (pwdEncryptSalt)，已终止提交以防明文发送密码');
  }
  const prefix = randomAesString(64);
  const ivStr = randomAesString(16);

  const key = CryptoJS.enc.Utf8.parse(trimmedSalt);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  const encrypted = CryptoJS.AES.encrypt(prefix + password, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString();
}

export interface PurgeableCredentials {
  username?: string;
  password?: string;
  encryptedPassword?: string;
  captcha?: string;
}

export function purgeEphemeralCredentials(creds: PurgeableCredentials | null | undefined): void {
  if (!creds) return;
  creds.username = '';
  creds.password = '';
  if ('encryptedPassword' in creds) creds.encryptedPassword = '';
  creds.captcha = '';
}

export function areCredentialsPurged(creds: PurgeableCredentials | null | undefined): boolean {
  if (!creds) return true;
  return (
    (creds.username ?? '') === '' &&
    (creds.password ?? '') === '' &&
    (creds.encryptedPassword ?? '') === '' &&
    (creds.captcha ?? '') === ''
  );
}
