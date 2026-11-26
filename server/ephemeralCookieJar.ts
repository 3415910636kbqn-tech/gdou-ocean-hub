/**
 * Pure in-memory ephemeral CookieJar & redirect-aware fetch client.
 * Never writes cookies to disk; `.wipe()` erases every cookie immediately after sync/logout.
 */

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  secure: boolean;
  expiresAt: number | null; // epoch ms
}

export interface EphemeralFetchResult {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export class EphemeralCookieJar {
  private cookies = new Map<string, StoredCookie>();

  private keyOf(domain: string, path: string, name: string): string {
    return `${domain.toLowerCase()}|${path}|${name}`;
  }

  public setCookiesFromResponse(response: Response, requestUrl: string): void {
    const rawList =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')
          ? [response.headers.get('set-cookie')!]
          : [];

    if (rawList.length === 0) return;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(requestUrl);
    } catch {
      return;
    }

    const reqHost = parsedUrl.hostname.toLowerCase();
    const defaultPath = parsedUrl.pathname.includes('/')
      ? parsedUrl.pathname.slice(0, parsedUrl.pathname.lastIndexOf('/') + 1) || '/'
      : '/';

    for (const raw of rawList) {
      const parts = raw.split(';').map((p) => p.trim());
      if (!parts[0]) continue;
      const eqIdx = parts[0].indexOf('=');
      if (eqIdx <= 0) continue;
      const name = parts[0].slice(0, eqIdx).trim();
      const value = parts[0].slice(eqIdx + 1).trim();

      let domain = reqHost;
      let hostOnly = true;
      let path = defaultPath;
      let secure = false;
      let expiresAt: number | null = null;

      for (let i = 1; i < parts.length; i++) {
        const attr = parts[i];
        const aEq = attr.indexOf('=');
        const aName = (aEq > 0 ? attr.slice(0, aEq) : attr).trim().toLowerCase();
        const aVal = aEq > 0 ? attr.slice(aEq + 1).trim() : '';

        if (aName === 'domain' && aVal) {
          domain = aVal.replace(/^\./, '').toLowerCase();
          hostOnly = false;
        } else if (aName === 'path' && aVal) {
          path = aVal.startsWith('/') ? aVal : '/';
        } else if (aName === 'secure') {
          secure = true;
        } else if (aName === 'max-age') {
          const secs = parseInt(aVal, 10);
          if (Number.isFinite(secs)) {
            expiresAt = secs <= 0 ? 0 : Date.now() + secs * 1000;
          }
        } else if (aName === 'expires' && aVal && expiresAt === null) {
          const ts = Date.parse(aVal);
          if (Number.isFinite(ts)) expiresAt = ts;
        }
      }

      const key = this.keyOf(domain, path, name);
      // Pin load-balancer `route` cookie strictly for authserver so GDOU never flips backend nodes mid-login
      const isAuthRouteCookie =
        path.toLowerCase().startsWith('/authserver') ||
        reqHost.includes('authserver.gdou.edu.cn');
      if (name === 'route' && isAuthRouteCookie) {
        const existing = this.cookies.get(key);
        if (existing && (existing.expiresAt === null || existing.expiresAt > Date.now())) {
          continue;
        }
      }

      if ((expiresAt !== null && expiresAt <= Date.now()) || value === '') {
        this.cookies.delete(key);
      } else {
        this.cookies.set(key, { name, value, domain, path, hostOnly, secure, expiresAt });
      }
    }
  }

  private extractWfwInnerPath(host: string, pathname: string): string | null {
    if (host !== 'wfw.gdou.edu.cn') return null;
    const prefixes = [
      '/https://authserver.gdou.edu.cn',
      '/http://authserver.gdou.edu.cn',
      '/https://jw.gdou.edu.cn',
      '/http://jw.gdou.edu.cn',
    ];
    const lower = pathname.toLowerCase();
    for (const p of prefixes) {
      if (lower.startsWith(p)) {
        const rest = pathname.slice(p.length) || '/';
        return rest.startsWith('/') ? rest : `/${rest}`;
      }
    }
    return null;
  }

  private pathMatches(pathname: string, cookiePath: string): boolean {
    return (
      pathname === cookiePath ||
      (cookiePath.endsWith('/') ? pathname.startsWith(cookiePath) : pathname.startsWith(`${cookiePath}/`))
    );
  }

  public getCookieHeader(targetUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return '';
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '/';
    const innerPath = this.extractWfwInnerPath(host, pathname);
    const isHttps = parsed.protocol === 'https:';
    const now = Date.now();
    const matched: StoredCookie[] = [];

    for (const [k, c] of this.cookies.entries()) {
      if (c.expiresAt !== null && c.expiresAt <= now) {
        this.cookies.delete(k);
        continue;
      }
      if (c.secure && !isHttps) continue;

      const domainMatch = c.hostOnly
        ? host === c.domain
        : host === c.domain || host.endsWith(`.${c.domain}`);
      if (!domainMatch) continue;

      const isPathMatch =
        this.pathMatches(pathname, c.path) ||
        (innerPath !== null && this.pathMatches(innerPath, c.path));
      if (!isPathMatch) continue;

      matched.push(c);
    }

    // Prefer longer (more-specific) path first and deduplicate by cookie name
    // so /authserver JSESSIONID/route never collide with jw Path=/ cookies behind wfw.gdou.edu.cn
    matched.sort((a, b) => b.path.length - a.path.length);
    const seen = new Set<string>();
    const deduped: StoredCookie[] = [];
    for (const c of matched) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        deduped.push(c);
      }
    }
    return deduped.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  public wipe(): void {
    this.cookies.clear();
  }

  public get size(): number {
    return this.cookies.size;
  }

  /**
   * Heal GDOU off-campus WebVPN (`wfw.gdou.edu.cn`) 3xx Location headers and upgrade
   * cleartext `http://*.gdou.edu.cn` redirects to `https://`.
   * Mirrors `withGdouZeroRetention.js` OkHttp / URLProtocol redirect healer 1:1.
   */
  private resolveAndHealRedirect(rawLoc: string, currentUrl: string): string {
    const loc = rawLoc.trim();
    let upgraded = loc;
    if (/^http:\/\/(?:[a-z0-9-]+\.)*gdou\.edu\.cn(?:[:/?#]|$)/i.test(upgraded)) {
      upgraded = upgraded.replace(/^http:\/\//i, 'https://').replace(/:80(?=[/?#]|$)/, '');
    }

    let curParsed: URL | null = null;
    try {
      curParsed = new URL(currentUrl);
    } catch {
      curParsed = null;
    }

    const isOnWfw = curParsed?.hostname.toLowerCase() === 'wfw.gdou.edu.cn';
    const curPathLower = (curParsed?.pathname ?? '').toLowerCase();
    const isInWfwProxiedPath = isOnWfw && curPathLower.startsWith('/https://');
    const curLower = currentUrl.toLowerCase();

    if (isOnWfw) {
      const wrongSsoMatch = upgraded.match(
        /^(?:https?:\/\/wfw\.gdou\.edu\.cn)?(?:\/https?:\/\/authserver\.gdou\.edu\.cn)?\/sso\/jziotlogin([?#].*)?$/i
      );
      if (wrongSsoMatch) {
        return `https://wfw.gdou.edu.cn/https://jw.gdou.edu.cn/sso/jziotlogin${wrongSsoMatch[1] ?? ''}`;
      }

      const bareJwMatch = upgraded.match(/^https?:\/\/jw\.gdou\.edu\.cn(\/.*)?$/i);
      if (bareJwMatch) {
        return `https://wfw.gdou.edu.cn/https://jw.gdou.edu.cn${bareJwMatch[1] ?? ''}`;
      }

      if (isInWfwProxiedPath) {
        const bareAuthMatch = upgraded.match(/^https?:\/\/authserver\.gdou\.edu\.cn(\/.*)?$/i);
        if (bareAuthMatch) {
          return `https://wfw.gdou.edu.cn/https://authserver.gdou.edu.cn${bareAuthMatch[1] ?? ''}`;
        }
      }

      if (
        loc.toLowerCase().startsWith('/authserver') &&
        curLower.includes('wfw.gdou.edu.cn/https://authserver.gdou.edu.cn')
      ) {
        return `https://wfw.gdou.edu.cn/https://authserver.gdou.edu.cn${loc}`;
      }

      if (
        loc.startsWith('/') &&
        !loc.toLowerCase().startsWith('/https://') &&
        !loc.toLowerCase().startsWith('/http://') &&
        !loc.toLowerCase().startsWith('/authserver') &&
        curLower.includes('wfw.gdou.edu.cn/https://jw.gdou.edu.cn')
      ) {
        return `https://wfw.gdou.edu.cn/https://jw.gdou.edu.cn${loc}`;
      }
    }

    let nextUrl = new URL(upgraded, currentUrl).toString();
    if (/^http:\/\/(?:[a-z0-9-]+\.)*gdou\.edu\.cn(?:[:/?#]|$)/i.test(nextUrl)) {
      nextUrl = nextUrl.replace(/^http:\/\//i, 'https://');
    }
    return nextUrl;
  }

  /**
   * Perform an HTTP request while automatically capturing Set-Cookie headers across
   * every 3xx redirect hop (Node's native fetch drops intermediate cookies on redirect).
   */
  public async fetch(
    initialUrl: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeoutMs?: number;
      maxRedirects?: number;
    } = {}
  ): Promise<EphemeralFetchResult> {
    const timeoutMs = init.timeoutMs ?? 20_000;
    const maxRedirects = init.maxRedirects ?? 12;

    let currentUrl = initialUrl;
    let currentMethod = (init.method ?? 'GET').toUpperCase();
    let currentBody = init.body;
    const baseHeaders = { ...(init.headers ?? {}) };

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const reqHeaders: Record<string, string> = { ...baseHeaders };
      const cookieHeader = this.getCookieHeader(currentUrl);
      if (cookieHeader) {
        reqHeaders['Cookie'] = cookieHeader;
      }

      let resp: Response;
      try {
        resp = await fetch(currentUrl, {
          method: currentMethod,
          headers: reqHeaders,
          body: currentMethod === 'GET' || currentMethod === 'HEAD' ? undefined : currentBody,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络连接`);
        }
        throw err;
      }
      clearTimeout(timer);

      this.setCookiesFromResponse(resp, currentUrl);

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc) {
          return {
            status: resp.status,
            ok: resp.ok,
            url: currentUrl,
            headers: resp.headers,
            text: () => resp.text(),
            arrayBuffer: () => resp.arrayBuffer(),
          };
        }
        // Drain body so socket is released
        try {
          await resp.arrayBuffer();
        } catch {
          // ignore
        }
        currentUrl = this.resolveAndHealRedirect(loc, currentUrl);
        if (resp.status === 301 || resp.status === 302 || resp.status === 303) {
          currentMethod = 'GET';
          currentBody = undefined;
          delete baseHeaders['Content-Type'];
          delete baseHeaders['Origin'];
        }
        continue;
      }

      return {
        status: resp.status,
        ok: resp.ok,
        url: currentUrl,
        headers: resp.headers,
        text: () => resp.text(),
        arrayBuffer: () => resp.arrayBuffer(),
      };
    }

    throw new Error('重定向次数过多，请稍后重试');
  }
}
