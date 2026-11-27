import { isNativeMobileApp } from './nativeHttpBridge';

export const APP_VERSION = '1.1.3';
export const APP_BUILD = 5;

export const PUBLIC_SERVER_ORIGIN = 'https://gdou.capqinal666888.online:8443';

export const ANDROID_APK_URL = `${PUBLIC_SERVER_ORIGIN}/downloads/gdou-schedule-android.apk`;
export const IOS_IPA_URL = `${PUBLIC_SERVER_ORIGIN}/downloads/gdou-schedule-ios-unsigned.ipa`;
export const IOS_ALTSTORE_SOURCE_URL = `${PUBLIC_SERVER_ORIGIN}/downloads/altstore-source.json`;
export const APP_VERSION_MANIFEST_URL = `${PUBLIC_SERVER_ORIGIN}/downloads/version.json`;

// One-click iOS sideload deep links (pointing directly to our fast domestic server!)
export const SIDESTORE_INSTALL_URL = `sidestore://install?url=${encodeURIComponent(IOS_IPA_URL)}`;
export const ALTSTORE_INSTALL_URL = `altstore://install?url=${encodeURIComponent(IOS_IPA_URL)}`;
export const TROLLSTORE_INSTALL_URL = `apple-magnifier://install?url=${encodeURIComponent(IOS_IPA_URL)}`;
export const FEATHER_ADD_SOURCE_URL = `feather://source/${IOS_ALTSTORE_SOURCE_URL}`;
export const SIDESTORE_ADD_SOURCE_URL = `sidestore://source?url=${encodeURIComponent(IOS_ALTSTORE_SOURCE_URL)}`;

export type ClientPlatform = 'android' | 'ios' | 'desktop';

export function detectClientPlatform(): ClientPlatform {
  if (typeof window !== 'undefined') {
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    const nativePlatform = cap?.getPlatform?.();
    if (nativePlatform === 'android') return 'android';
    if (nativePlatform === 'ios') return 'ios';
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
      return 'ios';
    }
  }
  return 'desktop';
}

export function isWeChatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent || '');
}

export function compareSemver(aRaw: string, bRaw: string): number {
  const parse = (s: string) =>
    String(s || '0.0.0')
      .trim()
      .replace(/^[vV]/, '')
      .split('.')
      .map((n) => parseInt(n.replace(/[^\d]/g, ''), 10) || 0);
  const a = parse(aRaw);
  const b = parse(bRaw);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

export interface RemoteVersionManifest {
  version: string;
  build: number;
  releaseDate: string;
  highlights: string[];
  android: {
    url: string;
    sizeBytes: number;
    sha256: string;
    signed: boolean;
  };
  ios: {
    url: string;
    sizeBytes: number;
    sha256: string;
    sourceUrl: string;
  };
}

export interface AppUpdateCheckResult {
  currentVersion: string;
  currentBuild: number;
  latestVersion: string;
  latestBuild: number;
  hasUpdate: boolean;
  releaseDate: string;
  highlights: string[];
  androidUrl: string;
  androidSizeLabel: string;
  iosUrl: string;
  iosSizeLabel: string;
  iosSourceUrl: string;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export async function checkAppUpdate(trigger: 'auto' | 'manual' = 'manual'): Promise<AppUpdateCheckResult> {
  const native = isNativeMobileApp();
  const platform = detectClientPlatform();
  const baseUrl = native ? APP_VERSION_MANIFEST_URL : '/downloads/version.json';
  const qs = `src=${native ? 'app' : 'web'}&p=${platform}&v=${encodeURIComponent(APP_VERSION)}&b=${APP_BUILD}&tr=${trigger}&t=${Date.now()}`;
  const resp = await fetch(`${baseUrl}?${qs}`, { cache: 'no-store' });
  if (!resp.ok) {
    throw new Error(`检查更新失败 (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as RemoteVersionManifest;
  const cmp = compareSemver(data.version, APP_VERSION);
  const hasUpdate = cmp > 0 || (cmp === 0 && (data.build ?? 0) > APP_BUILD);
  return {
    currentVersion: APP_VERSION,
    currentBuild: APP_BUILD,
    latestVersion: data.version,
    latestBuild: data.build,
    hasUpdate,
    releaseDate: data.releaseDate,
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
    androidUrl: data.android?.url || ANDROID_APK_URL,
    androidSizeLabel: formatBytes(data.android?.sizeBytes ?? 0),
    iosUrl: data.ios?.url || IOS_IPA_URL,
    iosSizeLabel: formatBytes(data.ios?.sizeBytes ?? 0),
    iosSourceUrl: data.ios?.sourceUrl || IOS_ALTSTORE_SOURCE_URL,
  };
}
