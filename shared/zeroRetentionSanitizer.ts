export const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  'username',
  'password',
  'pwd',
  'passwd',
  'cookie',
  'cookies',
  'token',
  'jsessionid',
  'wfwsessid',
  'tgc',
  'castgc',
  'pwdencryptsalt',
  'pwdEncryptSalt',
  'execution',
  'salt',
]);

const SENSITIVE_VALUE_REGEXES: RegExp[] = [
  /(\b(?:JSESSIONID|WFWSESSID|CASTGC|TGC|pwdEncryptSalt|password|passwd|ticket|token)\s*=\s*)([^;&\s"'<>]+)/gi,
  /(\b(?:Cookie|Set-Cookie)\s*:\s*)([^\r\n]+)/gi,
  /(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)([^\s\r\n]+)/gi,
];

export function sanitizeEndpointUrl(rawUrl: string): string {
  const s = String(rawUrl ?? '').trim();
  if (!s) return '';
  return s.split('#')[0].split('?')[0];
}

export function redactSensitiveStringValues(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of SENSITIVE_VALUE_REGEXES) {
    re.lastIndex = 0;
    out = out.replace(re, '$1[REDACTED]');
    re.lastIndex = 0;
  }
  return out;
}

export function sanitizeForZeroRetention<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSensitiveStringValues(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForZeroRetention(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_CREDENTIAL_KEYS.has(k.toLowerCase()) || FORBIDDEN_CREDENTIAL_KEYS.has(k)) {
        continue;
      }
      clean[k] = sanitizeForZeroRetention(v);
    }
    return clean as T;
  }
  return value;
}
