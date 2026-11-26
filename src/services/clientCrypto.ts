import CryptoJS from 'crypto-js';

const AES_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';

function randomAesStringBrowser(length: number): string {
  const alphabetLen = AES_CHARS.length; // 48
  const maxUnbiased = Math.floor(256 / alphabetLen) * alphabetLen; // 240
  let out = '';
  while (out.length < length) {
    const needed = length - out.length;
    const bytes = new Uint8Array(Math.max(16, needed * 2));
    window.crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      const b = bytes[i];
      if (b < maxUnbiased) {
        out += AES_CHARS.charAt(b % alphabetLen);
      }
    }
  }
  return out;
}

/**
 * Encrypts password right inside the user's browser using GDOU's Wisedu IDS
 * AES-128-CBC-PKCS7 algorithm + WebCrypto CSPRNG before sending anything to the server.
 * The server NEVER receives or sees the plaintext password.
 */
export function encryptGdouPasswordInBrowser(password: string, salt: string): string {
  const trimmedSalt = (salt ?? '').trim();
  if (!trimmedSalt || trimmedSalt.length < 16) {
    throw new Error('未获取到有效的海大认证加密盐值，已终止提交以防明文发送密码');
  }
  const prefix = randomAesStringBrowser(64);
  const ivStr = randomAesStringBrowser(16);
  const key = CryptoJS.enc.Utf8.parse(trimmedSalt);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  return CryptoJS.AES.encrypt(prefix + password, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString();
}
