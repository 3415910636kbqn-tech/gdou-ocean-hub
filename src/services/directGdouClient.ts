import {
  buildExamParamVariants,
  buildGradeQueryParams,
  DEFAULT_DESKTOP_UA,
  GDOU_AUTH_ORIGIN,
  GDOU_AUTH_PATHS,
  GDOU_AUTH_WFW_BASE,
  GDOU_ENTRY_URL,
  GDOU_JW_DIRECT_ORIGIN,
  GDOU_JW_PATHS,
  GDOU_JW_PREFIXES,
  GDOU_JW_SSO_SERVICE,
  GDOU_JW_WFW_BASE,
  GDOU_WFW_ORIGIN,
} from '../../shared/gdouEndpoints';
import { deriveCurrentTermParams, getDefaultTermStartDateForTerm } from '../../shared/gdouTimetable';
import type {
  CourseItem,
  EmptyRoomItem,
  ExamItem,
  GradeItem,
  LogoutVerificationDetails,
  PeriodTime,
  SyncResultPayload,
} from '../../shared/models';
import {
  computeTermWeek,
  getTodayDayOfWeek,
  parseZfEmptyRoomsResponse,
  parseZfExamResponse,
  parseZfGradesResponse,
  parseZfPeriodTimesResponse,
  parseZfScheduleResponse,
} from '../../shared/parsers';
import { sanitizeEndpointUrl } from '../../shared/zeroRetentionSanitizer';
import { encryptGdouPasswordInBrowser } from './clientCrypto';
import { NativeEphemeralCookieJar } from './nativeHttpBridge';

export interface DirectPreparedSession {
  entryFinalUrl: string;
  authOrigin: string;
  jwBaseUrl: string;
  isWebVpn: boolean;
  serviceUrl: string;
  pwdEncryptSalt: string;
  execution: string;
  lt: string;
  ephemeralBfp: string;
}

export interface DirectMfaState {
  reAuthUserId: string;
  serviceUrl: string;
  defaultReAuthType: '4' | '3';
  session: DirectPreparedSession;
  previousSteps: string[];
}

export interface DirectWfwSubAuthState {
  username: string;
  salt2: string;
  execution2: string;
  lt2: string;
  needCaptcha: boolean;
  captchaImageUri?: string;
  session: DirectPreparedSession;
  previousSteps: string[];
}

export type DirectSyncOutcome =
  | { status: 'completed'; result: SyncResultPayload }
  | { status: 'mfa_required'; mfa: DirectMfaState }
  | { status: 'wfw_subauth_required'; subAuth: DirectWfwSubAuthState };

const AUTH_ERROR_I18N: Record<string, string> = {
  accountLogin_account_pwd_error:
    '学号或「统一身份认证密码」错误（注意：是海大微门户/网上办事大厅的密码）',
  accountLogin_captcha_error: '图形验证码错误，请刷新验证码后重试',
  accountLogin_account_locked: '账号已被临时锁定，请等待 15-30 分钟后再试',
  accountLogin_dynamic_code_error: '动态验证码错误或已过期，请重新获取',
};

function generateSecureHexBrowser(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function encodeFormBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function isAccountLockedMessage(text: string): boolean {
  return /冻结|锁定|已被锁|密码错误次数过多|账号异常|account\s*locked|temporarily\s*locked/i.test(
    String(text ?? '')
  );
}

function extractHiddenInput(html: string, idOrName: string): string {
  const tagRegex = new RegExp(`<input[^>]+(?:id|name)=["']${idOrName}["'][^>]*>`, 'gi');
  const matches = html.match(tagRegex);
  if (!matches) return '';
  for (let i = matches.length - 1; i >= 0; i--) {
    const valMatch = matches[i].match(/value=["']([^"']*)["']/i);
    if (valMatch && valMatch[1]) return valMatch[1];
  }
  return '';
}

function extractServiceUrl(html: string): string {
  const m = html.match(/var\s+service\s*=\s*\[\s*["']([^"']+)["']\s*\]/);
  if (m && m[1]) return m[1].replace(/\\\//g, '/');
  return GDOU_JW_SSO_SERVICE;
}

function extractAuthError(html: string): string {
  const patterns = [
    /id=["']showErrorTip["'][^>]*>([\s\S]*?)<\/div>/gi,
    /id=["']showErrorTip["'][^>]*>([\s\S]*?)<\/span>/gi,
    /id=["']formErrorTip2?["'][^>]*>([\s\S]*?)<\/div>/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const clean = (m[1] || '').replace(/<[^>]+>/g, '').trim();
      if (clean) return AUTH_ERROR_I18N[clean] ?? clean;
    }
  }
  return '';
}

function parseSelectedOption(html: string, selectId: string): string | null {
  const selectRegex = new RegExp(
    `<select[^>]+id=["']${selectId}["'][^>]*>([\\s\\S]*?)<\\/select>`,
    'i'
  );
  const m = html.match(selectRegex);
  if (!m) return null;
  const optMatch = m[1].match(
    /<option[^>]+selected[^>]*value=["']([^"']*)["']|<option[^>]+value=["']([^"']*)["'][^>]*selected/i
  );
  if (optMatch) return (optMatch[1] || optMatch[2] || '').trim() || null;
  return null;
}

/**
 * Pure on-device direct GDOU sync controller for Android APK & iOS IPA.
 * Every HTTP request leaves directly from the student's own phone IP to `*.gdou.edu.cn`.
 */
export class DirectMobileSyncSession {
  private jar = new NativeEphemeralCookieJar();
  public prepared: DirectPreparedSession | null = null;
  public mfa: DirectMfaState | null = null;
  public subAuth: DirectWfwSubAuthState | null = null;

  public destroy(): void {
    this.jar.wipe();
    this.prepared = null;
    this.mfa = null;
    this.subAuth = null;
  }

  public async prepare(): Promise<{
    networkRoute: 'wfw-webvpn' | 'campus-direct';
    pwdEncryptSalt: string;
  }> {
    this.jar.wipe();
    const ephemeralBfp = generateSecureHexBrowser(16);
    const netResp = await this.jar.fetch(GDOU_ENTRY_URL, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeoutMs: 15_000,
    });
    const netHtml = netResp.text();
    const isWebVpn = netResp.url.includes('wfw.gdou.edu.cn');
    const jwBaseUrl = isWebVpn ? GDOU_JW_WFW_BASE : GDOU_JW_DIRECT_ORIGIN;
    const serviceUrl = isWebVpn
      ? `${GDOU_WFW_ORIGIN}/`
      : extractServiceUrl(netHtml) || GDOU_JW_SSO_SERVICE;
    const authOrigin = GDOU_AUTH_ORIGIN;
    const authLoginUrl = `${authOrigin}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(serviceUrl)}`;

    this.jar.wipe();
    const authResp = await this.jar.fetch(authLoginUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const authHtml = authResp.text();

    await this.jar
      .fetch(`${authOrigin}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${ephemeralBfp}`, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
        timeoutMs: 10_000,
      })
      .catch(() => undefined);

    const pwdEncryptSalt =
      extractHiddenInput(authHtml, 'pwdEncryptSalt') || extractHiddenInput(netHtml, 'pwdEncryptSalt');
    const execution =
      extractHiddenInput(authHtml, 'execution') || extractHiddenInput(netHtml, 'execution');
    const lt = extractHiddenInput(authHtml, 'lt') || extractHiddenInput(netHtml, 'lt');

    this.prepared = {
      entryFinalUrl: authLoginUrl,
      authOrigin,
      jwBaseUrl,
      isWebVpn,
      serviceUrl,
      pwdEncryptSalt,
      execution,
      lt,
      ephemeralBfp,
    };

    return {
      networkRoute: isWebVpn ? 'wfw-webvpn' : 'campus-direct',
      pwdEncryptSalt,
    };
  }

  private async fetchCaptchaImage(baseOrigin: string, referer: string): Promise<string | undefined> {
    const resp = await this.jar.fetch(`${baseOrigin}${GDOU_AUTH_PATHS.getCaptcha}?${Date.now()}`, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: referer,
      },
      timeoutMs: 12_000,
    });
    if (!resp.ok) return undefined;
    const b64 = resp.base64();
    if (!b64 || b64.length < 80) return undefined;
    const mime = (resp.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    return `data:${mime};base64,${b64}`;
  }

  public async checkCaptcha(
    username: string,
    forceRefresh = false
  ): Promise<{ isNeed: boolean; imageDataUri?: string }> {
    if (!this.prepared) return { isNeed: false };
    if (forceRefresh) {
      const origin = this.subAuth ? GDOU_AUTH_WFW_BASE : this.prepared.authOrigin;
      const referer = this.subAuth
        ? `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}`
        : this.prepared.entryFinalUrl;
      const imageDataUri = await this.fetchCaptchaImage(origin, referer);
      return { isNeed: Boolean(imageDataUri), imageDataUri };
    }
    const trimmed = username.trim();
    if (!trimmed) return { isNeed: false };
    const resp = await this.jar.fetch(
      `${this.prepared.authOrigin}${GDOU_AUTH_PATHS.checkNeedCaptcha}?username=${encodeURIComponent(
        trimmed
      )}&_=${Date.now()}`,
      { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA }, timeoutMs: 12_000 }
    );
    if (!resp.ok) return { isNeed: false };
    const txt = resp.text().trim();
    if (!txt.startsWith('{')) return { isNeed: false };
    const data = JSON.parse(txt) as { isNeed?: boolean };
    if (!data.isNeed) return { isNeed: false };
    const imageDataUri = await this.fetchCaptchaImage(
      this.prepared.authOrigin,
      this.prepared.entryFinalUrl
    );
    return { isNeed: true, imageDataUri };
  }

  private async logoutAll(
    session: DirectPreparedSession,
    detectedPrefix = ''
  ): Promise<LogoutVerificationDetails> {
    const urls = [`${session.jwBaseUrl}${detectedPrefix}/logout`];
    if (session.isWebVpn) {
      urls.push(`${GDOU_WFW_ORIGIN}/logout`);
      if (session.authOrigin !== GDOU_AUTH_ORIGIN) {
        urls.push(`${session.authOrigin}${GDOU_AUTH_PATHS.logout}`);
      }
    }
    let attempted = 0;
    let succeeded = 0;
    const failedEndpoints: string[] = [];

    for (const url of urls) {
      attempted++;
      try {
        const r = await this.jar.fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
          timeoutMs: 8_000,
        });
        if (r.ok || (r.status >= 300 && r.status < 400)) succeeded++;
        else failedEndpoints.push(`${sanitizeEndpointUrl(url)} (HTTP ${r.status})`);
      } catch {
        failedEndpoints.push(sanitizeEndpointUrl(url));
      }
    }

    const casUrl = `${GDOU_AUTH_ORIGIN}${GDOU_AUTH_PATHS.logout}`;
    attempted++;
    let casLoggedOut = false;
    try {
      const r = await this.jar.fetch(casUrl, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
        timeoutMs: 8_000,
      });
      if (r.ok || (r.status >= 300 && r.status < 400)) {
        casLoggedOut = true;
        succeeded++;
      } else {
        failedEndpoints.push(`${sanitizeEndpointUrl(casUrl)} (HTTP ${r.status})`);
      }
    } catch {
      failedEndpoints.push(sanitizeEndpointUrl(casUrl));
    }

    this.jar.wipe();
    return { attempted, succeeded, casLoggedOut, failedEndpoints };
  }

  private async detectPrefixAndTerm(
    jwBaseUrl: string,
    xnmOverride?: string,
    xqmOverride?: string
  ) {
    const derived = deriveCurrentTermParams();
    let prefix = '';
    let xnm = xnmOverride || '';
    let xqm = xqmOverride || '';

    for (const p of GDOU_JW_PREFIXES) {
      try {
        const resp = await this.jar.fetch(`${jwBaseUrl}${p}${GDOU_JW_PATHS.scheduleIndex}`, {
          method: 'GET',
          headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
        });
        if (!resp.ok) continue;
        const html = resp.text();
        if (html.includes('pwdEncryptSalt') || html.includes('统一身份认证平台')) continue;
        if (html.includes('xnm') || html.includes('xskbcx') || html.includes('课表')) {
          prefix = p;
          if (!xnm) xnm = parseSelectedOption(html, 'xnm') || '';
          if (!xqm) xqm = parseSelectedOption(html, 'xqm') || '';
          break;
        }
      } catch {
        // next prefix
      }
    }

    xnm = xnm || derived.xnm;
    xqm = xqm || derived.xqm;
    const semText =
      xqm === '3' ? '第1学期' : xqm === '12' ? '第2学期' : xqm === '16' ? '第3学期' : '当前学期';
    const yearNum = parseInt(xnm, 10);
    const termLabel = Number.isFinite(yearNum)
      ? `${yearNum}-${yearNum + 1}学年 ${semText}`
      : derived.label;
    return { prefix, xnm, xqm, termLabel };
  }

  private async fetchScheduleJson(
    jwBaseUrl: string,
    prefix: string,
    xnm: string,
    xqm: string
  ): Promise<unknown> {
    const resp = await this.jar.fetch(`${jwBaseUrl}${prefix}${GDOU_JW_PATHS.scheduleQuery}`, {
      method: 'POST',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      body: encodeFormBody({ xnm, xqm, kzlx: 'ck', xsdm: '' }),
    });
    const trimmed = resp.text().trim();
    if (
      !resp.ok ||
      resp.status === 901 ||
      !trimmed ||
      trimmed.includes('统一身份认证') ||
      trimmed.includes('pwdEncryptSalt') ||
      (!trimmed.startsWith('{') && !trimmed.startsWith('['))
    ) {
      throw new Error(`教务系统会话尚未激活 (HTTP ${resp.status})，请重试`);
    }
    return JSON.parse(trimmed);
  }

  private async pullAllJwData(
    session: DirectPreparedSession,
    steps: string[],
    xnmOverride?: string,
    xqmOverride?: string
  ) {
    const warnings: string[] = [];
    let { prefix, xnm, xqm, termLabel } = await this.detectPrefixAndTerm(
      session.jwBaseUrl,
      xnmOverride,
      xqmOverride
    );
    steps.push(`5. 本机直连锁定学期：${termLabel}`);

    let rawSchedule: unknown;
    try {
      rawSchedule = await this.fetchScheduleJson(session.jwBaseUrl, prefix, xnm, xqm);
    } catch {
      const retryBase = session.isWebVpn ? GDOU_AUTH_WFW_BASE : session.authOrigin;
      await this.jar.fetch(
        `${retryBase}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
        { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
      );
      const redetected = await this.detectPrefixAndTerm(session.jwBaseUrl, xnmOverride, xqmOverride);
      prefix = redetected.prefix;
      xnm = redetected.xnm;
      xqm = redetected.xqm;
      termLabel = redetected.termLabel;
      rawSchedule = await this.fetchScheduleJson(session.jwBaseUrl, prefix, xnm, xqm);
    }

    let parsedSchedule = parseZfScheduleResponse(rawSchedule);
    if (parsedSchedule.courses.length === 0 && !xnmOverride && !xqmOverride) {
      const y = parseInt(xnm, 10);
      if (Number.isFinite(y)) {
        const prev =
          xqm === '3'
            ? { xnm: String(y - 1), xqm: '12', label: `${y - 1}-${y}学年 第2学期` }
            : { xnm: String(y), xqm: '3', label: `${y}-${y + 1}学年 第1学期` };
        try {
          const prevRaw = await this.fetchScheduleJson(session.jwBaseUrl, prefix, prev.xnm, prev.xqm);
          const prevParsed = parseZfScheduleResponse(prevRaw);
          if (prevParsed.courses.length > 0) {
            xnm = prev.xnm;
            xqm = prev.xqm;
            termLabel = prevParsed.termLabel || prev.label;
            parsedSchedule = prevParsed;
          }
        } catch {
          // ignore
        }
      }
    }
    if (parsedSchedule.warnings.length > 0) warnings.push(...parsedSchedule.warnings);

    // Period times
    let syncedPeriods: PeriodTime[] = [];
    for (const params of [
      { xnm, xqm, xqh_id: parsedSchedule.campusId || '1' } as Record<string, string>,
      { xnm, xqm } as Record<string, string>,
    ]) {
      try {
        const resp = await this.jar.fetch(`${session.jwBaseUrl}${prefix}${GDOU_JW_PATHS.periodTimes}`, {
          method: 'POST',
          headers: {
            'User-Agent': DEFAULT_DESKTOP_UA,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: encodeFormBody(params),
          timeoutMs: 10_000,
        });
        if (!resp.ok) continue;
        const t = resp.text().trim();
        if (t.startsWith('{') || t.startsWith('[')) {
          const p = parseZfPeriodTimesResponse(JSON.parse(t));
          if (p.length >= 8) {
            syncedPeriods = p;
            break;
          }
        }
      } catch {
        // non-fatal
      }
    }
    steps.push(`6. 课表解析完成：共 ${parsedSchedule.courses.length} 项课程`);

    // Exams
    let examData: unknown = { items: [] };
    let attempts = 0;
    examLoop: for (const p of GDOU_JW_PATHS.examQueries) {
      for (const bodyParams of buildExamParamVariants(xnm, xqm)) {
        if (attempts >= 4) break examLoop;
        attempts++;
        try {
          const resp = await this.jar.fetch(`${session.jwBaseUrl}${prefix}${p}`, {
            method: 'POST',
            headers: {
              'User-Agent': DEFAULT_DESKTOP_UA,
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: encodeFormBody(bodyParams),
          });
          if (!resp.ok) continue;
          const txt = resp.text().trim();
          if (!txt.startsWith('{') && !txt.startsWith('[')) continue;
          const parsed = JSON.parse(txt) as { items?: unknown[]; rows?: unknown[] };
          const count = Array.isArray(parsed.items)
            ? parsed.items.length
            : Array.isArray(parsed.rows)
              ? parsed.rows.length
              : 0;
          if (count > 0) {
            examData = parsed;
            break examLoop;
          }
        } catch {
          // next
        }
      }
    }
    const exams: ExamItem[] = parseZfExamResponse(examData);

    // Grades
    let gradeData: unknown = { items: [] };
    const gradeBody = encodeFormBody(buildGradeQueryParams());
    for (const p of GDOU_JW_PATHS.gradeQueries) {
      try {
        const resp = await this.jar.fetch(`${session.jwBaseUrl}${prefix}${p}`, {
          method: 'POST',
          headers: {
            'User-Agent': DEFAULT_DESKTOP_UA,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: gradeBody,
        });
        if (!resp.ok) continue;
        const txt = resp.text().trim();
        if (txt.startsWith('{')) {
          gradeData = JSON.parse(txt);
          break;
        }
      } catch {
        // next
      }
    }
    const grades: GradeItem[] = parseZfGradesResponse(gradeData);

    // Today's empty rooms (safe on native device since every phone uses its own IP!)
    const emptyRooms: EmptyRoomItem[] = [];
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const dateText = `${y}-${m}-${d}`;
      const startDate = getDefaultTermStartDateForTerm(xnm, xqm) ?? `${y}-09-01`;
      const week = Math.min(20, Math.max(1, computeTermWeek(startDate, now)));
      const dayOfWeek = getTodayDayOfWeek(now);
      const zcdMask = String(1 << (week - 1));
      const slots = [
        { label: '1-2节', jcd: '3' },
        { label: '3-4节', jcd: '12' },
        { label: '5-6节', jcd: '48' },
        { label: '7-8节', jcd: '192' },
        { label: '9-10节', jcd: '768' },
      ];
      let workingEndpoint: string | null = null;
      for (const slot of slots) {
        const candidates: string[] = workingEndpoint
          ? [workingEndpoint]
          : GDOU_JW_PATHS.emptyRoomQueries.map((p) => `${session.jwBaseUrl}${prefix}${p}`);
        for (const ep of candidates) {
          const resp = await this.jar.fetch(ep, {
            method: 'POST',
            headers: {
              'User-Agent': DEFAULT_DESKTOP_UA,
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: encodeFormBody({
              fwzt: 'cx',
              xqh_id: parsedSchedule.campusId || '1',
              xnm,
              xqm,
              cdlb_id: '',
              cdejlb_id: '',
              qszws: '',
              jszws: '',
              cdmc: '',
              lh: '',
              jyfs: '0',
              cdjylx: '',
              zcd: zcdMask,
              xqj: String(dayOfWeek),
              jcd: slot.jcd,
              _search: 'false',
              nd: String(Date.now()),
              'queryModel.showCount': '120',
              'queryModel.currentPage': '1',
              'queryModel.sortName': 'cdbh',
              'queryModel.sortOrder': 'asc',
              time: '0',
            }),
            timeoutMs: 6_000,
          });
          if (!resp.ok) continue;
          const txt = resp.text().trim();
          if (!txt.startsWith('{') && !txt.startsWith('[')) continue;
          const parsed = parseZfEmptyRoomsResponse(JSON.parse(txt), slot.label, dateText);
          if (parsed.length > 0) {
            workingEndpoint = ep;
            emptyRooms.push(...parsed);
            break;
          }
        }
      }
    } catch {
      // non-fatal
    }

    steps.push(
      `7. 拉取完成：考试 ${exams.length} 场、成绩 ${grades.length} 门、空教室 ${emptyRooms.length} 条`
    );

    return {
      prefix,
      courses: parsedSchedule.courses as CourseItem[],
      exams,
      grades,
      emptyRooms,
      syncedPeriods: syncedPeriods.length >= 8 ? syncedPeriods : undefined,
      detectedCampus: parsedSchedule.campusName,
      termLabel: parsedSchedule.termLabel || termLabel,
      academicYear: xnm,
      semesterCode: xqm,
      warnings,
    };
  }

  private async handoffToJw(
    session: DirectPreparedSession,
    needWfwActivation: boolean,
    username: string,
    steps: string[]
  ): Promise<
    | { status: 'ready' }
    | { status: 'wfw_subauth_required'; subAuth: DirectWfwSubAuthState }
  > {
    if (!session.isWebVpn) {
      await this.jar.fetch(
        `${session.authOrigin}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
        { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
      );
      return { status: 'ready' };
    }

    if (session.authOrigin === GDOU_AUTH_WFW_BASE) {
      await this.jar.fetch(
        `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
        { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
      );
      return { status: 'ready' };
    }

    if (needWfwActivation) {
      await this.jar
        .fetch(
          `${GDOU_AUTH_ORIGIN}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(`${GDOU_WFW_ORIGIN}/`)}`,
          { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
        )
        .catch(() => undefined);
    }

    const jwEntryResp = await this.jar.fetch(GDOU_JW_WFW_BASE, {
      method: 'GET',
      headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
    });
    const jwEntryHtml = jwEntryResp.text();
    let salt2 = extractHiddenInput(jwEntryHtml, 'pwdEncryptSalt');
    let exe2 = extractHiddenInput(jwEntryHtml, 'execution');
    let lt2 = extractHiddenInput(jwEntryHtml, 'lt');

    if (
      !salt2 &&
      jwEntryResp.ok &&
      (jwEntryHtml.includes('index_initMenu') ||
        jwEntryHtml.includes('教学管理信息服务平台') ||
        jwEntryHtml.includes('xskbcx'))
    ) {
      return { status: 'ready' };
    }

    try {
      const authWfwResp = await this.jar.fetch(
        `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
        { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
      );
      if (authWfwResp.ok) {
        const html = authWfwResp.text();
        const freshSalt = extractHiddenInput(html, 'pwdEncryptSalt');
        const freshExe = extractHiddenInput(html, 'execution');
        const freshLt = extractHiddenInput(html, 'lt');
        if (freshSalt && freshExe) {
          salt2 = freshSalt;
          exe2 = freshExe;
          lt2 = freshLt;
        } else if (
          html.includes('index_initMenu') ||
          html.includes('教学管理信息服务平台') ||
          html.includes('xskbcx')
        ) {
          return { status: 'ready' };
        }
      }
    } catch {
      // ignore
    }

    if (!salt2 || !exe2) return { status: 'ready' };

    let needCaptcha = false;
    let captchaImageUri: string | undefined;
    try {
      const capResp = await this.jar.fetch(
        `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.checkNeedCaptcha}?username=${encodeURIComponent(
          username
        )}&_=${Date.now()}`,
        { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
      );
      const capTxt = capResp.text().trim();
      if (capTxt.startsWith('{') && (JSON.parse(capTxt) as { isNeed?: boolean }).isNeed) {
        needCaptcha = true;
        captchaImageUri = await this.fetchCaptchaImage(
          GDOU_AUTH_WFW_BASE,
          `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}`
        );
      }
    } catch {
      // ignore
    }

    const subAuth: DirectWfwSubAuthState = {
      username,
      salt2,
      execution2: exe2,
      lt2,
      needCaptcha,
      captchaImageUri,
      session,
      previousSteps: steps,
    };
    this.subAuth = subAuth;
    return { status: 'wfw_subauth_required', subAuth };
  }

  public async login(
    username: string,
    password: string,
    captcha: string,
    xnm?: string,
    xqm?: string
  ): Promise<DirectSyncOutcome> {
    if (!this.prepared) throw new Error('通道尚未准备，请点击重连');
    const session = this.prepared;
    const steps: string[] = [];
    let keepSession = false;
    let logoutCompleted = false;
    let detectedPrefix = '';

    try {
      steps.push(
        session.isWebVpn
          ? '1. 手机本机直连海大校外微门户 (wfw.gdou.edu.cn，零中转)'
          : '1. 手机本机直连海大校园网教务 (jw.gdou.edu.cn，零中转)'
      );
      const encryptedPwd = encryptGdouPasswordInBrowser(password, session.pwdEncryptSalt);
      steps.push('2. 密码已在本机 AES-128-CBC 加密，正在直连海大官方认证...');

      const loginAction = `${session.authOrigin}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(
        session.serviceUrl
      )}`;
      const loginResp = await this.jar.fetch(loginAction, {
        method: 'POST',
        headers: {
          'User-Agent': DEFAULT_DESKTOP_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: session.authOrigin,
          Referer: loginAction,
        },
        body: encodeFormBody({
          username: username.trim(),
          password: encryptedPwd,
          captcha: captcha.trim(),
          _eventId: 'submit',
          cllt: 'userNameLogin',
          dllt: 'generalLogin',
          lt: session.lt,
          execution: session.execution,
        }),
      });

      const loginHtml = loginResp.text();
      if (
        loginResp.url.includes('reAuthLoginView.do') ||
        loginHtml.includes('reAuthParams') ||
        loginHtml.includes('多因子认证')
      ) {
        keepSession = true;
        const userIdMatch = loginHtml.match(/"reAuthUserId"\s*:\s*"([^"]+)"/);
        const typeMatch = loginHtml.match(/"reAuthType"\s*:\s*"([34])"/);
        steps.push('3. 统一认证通过，海大安全策略要求完成多因子验证');
        this.mfa = {
          reAuthUserId: userIdMatch ? userIdMatch[1] : username.trim(),
          serviceUrl: session.serviceUrl,
          defaultReAuthType: (typeMatch?.[1] as '4' | '3') || '4',
          session,
          previousSteps: steps,
        };
        return { status: 'mfa_required', mfa: this.mfa };
      }

      if (isAccountLockedMessage(loginHtml)) {
        throw new Error('检测到海大账号已触发临时锁定保护，已立即熔断停止请求。');
      }
      if (
        loginHtml.includes('pwdEncryptSalt') &&
        (loginHtml.includes('pwdFromId') || loginHtml.includes('loginFromId'))
      ) {
        throw new Error(extractAuthError(loginHtml) || '学号、密码或验证码错误，请核对后重试');
      }

      steps.push('3. 统一认证通过，正在打通教务系统会话...');
      const alreadyOnJw =
        loginResp.url.includes('jw.gdou.edu.cn') &&
        !loginHtml.includes('pwdEncryptSalt') &&
        !loginHtml.includes('reAuthParams');
      const needWfwActivation = session.isWebVpn && !loginResp.url.includes('wfw.gdou.edu.cn');

      if (!alreadyOnJw) {
        const handoff = await this.handoffToJw(session, needWfwActivation, username.trim(), steps);
        if (handoff.status === 'wfw_subauth_required') {
          if (!handoff.subAuth.needCaptcha) {
            // Seamlessly finish WFW Step-2 locally on the phone!
            keepSession = true;
            return await this.completeWfwSubAuth(password, '', xnm, xqm);
          }
          keepSession = true;
          return handoff;
        }
      }

      const pulled = await this.pullAllJwData(session, steps, xnm, xqm);
      detectedPrefix = pulled.prefix;
      const logoutDetails = await this.logoutAll(session, detectedPrefix);
      logoutCompleted = true;

      steps.push(
        `8. 本机已注销官网会话（${logoutDetails.succeeded}/${logoutDetails.attempted} 项确认），内存 Cookie 已清空`
      );
      return {
        status: 'completed',
        result: {
          courses: pulled.courses,
          exams: pulled.exams,
          grades: pulled.grades,
          emptyRooms: pulled.emptyRooms,
          syncedPeriods: pulled.syncedPeriods,
          detectedCampus: pulled.detectedCampus,
          termLabel: pulled.termLabel,
          academicYear: pulled.academicYear,
          semesterCode: pulled.semesterCode,
          receipt: {
            syncedAtIso: new Date().toISOString(),
            mode: 'direct',
            networkRoute: session.isWebVpn ? 'wfw-webvpn' : 'campus-direct',
            termLabel: pulled.termLabel,
            coursesCount: pulled.courses.length,
            examsCount: pulled.exams.length,
            gradesCount: pulled.grades.length,
            emptyRoomsCount: pulled.emptyRooms.length,
            credentialsPurged: true,
            sessionLoggedOut: logoutDetails.casLoggedOut && logoutDetails.failedEndpoints.length === 0,
            storageCleaned: this.jar.size === 0,
            cookiesFlushed: this.jar.size === 0 && logoutDetails.casLoggedOut,
            logoutDetails,
            warnings: pulled.warnings.length > 0 ? pulled.warnings : undefined,
            steps,
          },
        },
      };
    } finally {
      if (!keepSession && !logoutCompleted) {
        await this.logoutAll(session, detectedPrefix).catch(() => this.jar.wipe());
      }
    }
  }

  public async sendMfa(reAuthType: '4' | '3'): Promise<string> {
    if (!this.mfa) throw new Error('多因子会话已过期，请重新连接');
    const origin = this.mfa.session.authOrigin;
    await this.jar
      .fetch(`${origin}${GDOU_AUTH_PATHS.changeReAuthType}`, {
        method: 'POST',
        headers: {
          'User-Agent': DEFAULT_DESKTOP_UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: encodeFormBody({
          isMultifactor: 'true',
          reAuthType,
          service: this.mfa.serviceUrl,
        }),
      })
      .catch(() => undefined);

    const authCodeTypeName =
      reAuthType === '4' ? 'reAuthWChatDynamicCodeType' : 'reAuthDynamicCodeType';
    const resp = await this.jar.fetch(`${origin}${GDOU_AUTH_PATHS.getReAuthCode}`, {
      method: 'POST',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: encodeFormBody({
        userName: this.mfa.reAuthUserId,
        authCodeTypeName,
      }),
    });
    if (!resp.ok) throw new Error(`发送多因子验证码失败 (HTTP ${resp.status})`);
    const raw = resp.text().trim();
    if (raw.startsWith('{')) {
      try {
        const d = JSON.parse(raw) as { returnMessage?: string; mobile?: string };
        const msg = [d.returnMessage, d.mobile].filter(Boolean).join(' ');
        if (msg) return msg;
      } catch {
        // ignore
      }
    }
    return reAuthType === '4' ? '企业微信验证码已发送，请查收' : '短信验证码已发送，请查收';
  }

  public async submitMfa(
    dynamicCode: string,
    reAuthType: '4' | '3',
    xnm?: string,
    xqm?: string
  ): Promise<DirectSyncOutcome> {
    if (!this.mfa) throw new Error('多因子会话已过期，请重新连接');
    const mfa = this.mfa;
    const steps = [...mfa.previousSteps];
    let keepSession = false;
    let logoutCompleted = false;
    let detectedPrefix = '';

    try {
      const origin = mfa.session.authOrigin;
      await this.jar
        .fetch(`${origin}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${mfa.session.ephemeralBfp}`, {
          method: 'GET',
          headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
          timeoutMs: 10_000,
        })
        .catch(() => undefined);

      const resp = await this.jar.fetch(`${origin}${GDOU_AUTH_PATHS.reAuthSubmit}`, {
        method: 'POST',
        headers: {
          'User-Agent': DEFAULT_DESKTOP_UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: encodeFormBody({
          service: mfa.serviceUrl,
          reAuthType,
          isMultifactor: 'true',
          password: '',
          dynamicCode: dynamicCode.trim(),
          uuid: '',
          answer1: '',
          answer2: '',
          otpCode: '',
          skipTmpReAuth: 'true',
        }),
      });

      const txt = resp.text().trim();
      if (txt.startsWith('{')) {
        const data = JSON.parse(txt) as { code?: string; msg?: string };
        if (data.code === 'reAuth_failed' || data.code === 'reAuth_unauthorized') {
          throw new Error(data.msg || '二次认证验证码错误或已过期，请重新输入');
        }
      }

      steps.push('4. 多因子二次认证通过，正在激活教务系统会话...');
      const handoff = await this.handoffToJw(mfa.session, mfa.session.isWebVpn, mfa.reAuthUserId, steps);
      if (handoff.status === 'wfw_subauth_required') {
        keepSession = true;
        return handoff;
      }

      const pulled = await this.pullAllJwData(mfa.session, steps, xnm, xqm);
      detectedPrefix = pulled.prefix;
      const logoutDetails = await this.logoutAll(mfa.session, detectedPrefix);
      logoutCompleted = true;

      steps.push(
        `8. 本机已注销官网会话（${logoutDetails.succeeded}/${logoutDetails.attempted} 项确认），内存 Cookie 已清空`
      );
      return {
        status: 'completed',
        result: {
          courses: pulled.courses,
          exams: pulled.exams,
          grades: pulled.grades,
          emptyRooms: pulled.emptyRooms,
          syncedPeriods: pulled.syncedPeriods,
          detectedCampus: pulled.detectedCampus,
          termLabel: pulled.termLabel,
          academicYear: pulled.academicYear,
          semesterCode: pulled.semesterCode,
          receipt: {
            syncedAtIso: new Date().toISOString(),
            mode: 'direct',
            networkRoute: mfa.session.isWebVpn ? 'wfw-webvpn' : 'campus-direct',
            termLabel: pulled.termLabel,
            coursesCount: pulled.courses.length,
            examsCount: pulled.exams.length,
            gradesCount: pulled.grades.length,
            emptyRoomsCount: pulled.emptyRooms.length,
            credentialsPurged: true,
            sessionLoggedOut: logoutDetails.casLoggedOut && logoutDetails.failedEndpoints.length === 0,
            storageCleaned: this.jar.size === 0,
            cookiesFlushed: this.jar.size === 0 && logoutDetails.casLoggedOut,
            logoutDetails,
            warnings: pulled.warnings.length > 0 ? pulled.warnings : undefined,
            steps,
          },
        },
      };
    } finally {
      if (!keepSession && !logoutCompleted) {
        await this.logoutAll(mfa.session, detectedPrefix).catch(() => this.jar.wipe());
      }
    }
  }

  public async completeWfwSubAuth(
    password: string,
    captcha: string,
    xnm?: string,
    xqm?: string
  ): Promise<DirectSyncOutcome> {
    if (!this.subAuth) throw new Error('校外子会话已过期，请重新连接');
    const subAuth = this.subAuth;
    const steps = [...subAuth.previousSteps];
    let keepSession = false;
    let logoutCompleted = false;
    let detectedPrefix = '';

    try {
      const encryptedPwd2 = encryptGdouPasswordInBrowser(password, subAuth.salt2);
      await this.jar
        .fetch(`${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${subAuth.session.ephemeralBfp}`, {
          method: 'GET',
          headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
          timeoutMs: 10_000,
        })
        .catch(() => undefined);

      const wfwAuthPostUrl = `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(
        GDOU_JW_SSO_SERVICE
      )}`;
      const resp = await this.jar.fetch(wfwAuthPostUrl, {
        method: 'POST',
        headers: {
          'User-Agent': DEFAULT_DESKTOP_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: GDOU_WFW_ORIGIN,
          Referer: wfwAuthPostUrl,
        },
        body: encodeFormBody({
          username: subAuth.username,
          password: encryptedPwd2,
          captcha: captcha.trim(),
          _eventId: 'submit',
          cllt: 'userNameLogin',
          dllt: 'generalLogin',
          lt: subAuth.lt2,
          execution: subAuth.execution2,
        }),
      });

      const html = resp.text();
      if (isAccountLockedMessage(html)) {
        throw new Error('检测到海大账号已触发临时锁定保护，已立即熔断停止请求。');
      }
      if (
        resp.url.includes('reAuthLoginView.do') ||
        html.includes('reAuthParams') ||
        html.includes('多因子认证')
      ) {
        keepSession = true;
        await this.jar
          .fetch(`${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${subAuth.session.ephemeralBfp}`, {
            method: 'GET',
            headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
            timeoutMs: 10_000,
          })
          .catch(() => undefined);
        const userIdMatch = html.match(/"reAuthUserId"\s*:\s*"([^"]+)"/);
        const typeMatch = html.match(/"reAuthType"\s*:\s*"([34])"/);
        this.mfa = {
          reAuthUserId: userIdMatch ? userIdMatch[1] : subAuth.username,
          serviceUrl: GDOU_JW_SSO_SERVICE,
          defaultReAuthType: (typeMatch?.[1] as '4' | '3') || '4',
          session: {
            ...subAuth.session,
            authOrigin: GDOU_AUTH_WFW_BASE,
            serviceUrl: GDOU_JW_SSO_SERVICE,
          },
          previousSteps: steps,
        };
        return { status: 'mfa_required', mfa: this.mfa };
      }
      if (html.includes('pwdEncryptSalt')) {
        throw new Error(extractAuthError(html) || `校外教务子会话验证未通过 (HTTP ${resp.status})`);
      }

      const pulled = await this.pullAllJwData(subAuth.session, steps, xnm, xqm);
      detectedPrefix = pulled.prefix;
      const logoutDetails = await this.logoutAll(subAuth.session, detectedPrefix);
      logoutCompleted = true;

      steps.push(
        `8. 本机已注销官网会话（${logoutDetails.succeeded}/${logoutDetails.attempted} 项确认），内存 Cookie 已清空`
      );
      return {
        status: 'completed',
        result: {
          courses: pulled.courses,
          exams: pulled.exams,
          grades: pulled.grades,
          emptyRooms: pulled.emptyRooms,
          syncedPeriods: pulled.syncedPeriods,
          detectedCampus: pulled.detectedCampus,
          termLabel: pulled.termLabel,
          academicYear: pulled.academicYear,
          semesterCode: pulled.semesterCode,
          receipt: {
            syncedAtIso: new Date().toISOString(),
            mode: 'direct',
            networkRoute: 'wfw-webvpn',
            termLabel: pulled.termLabel,
            coursesCount: pulled.courses.length,
            examsCount: pulled.exams.length,
            gradesCount: pulled.grades.length,
            emptyRoomsCount: pulled.emptyRooms.length,
            credentialsPurged: true,
            sessionLoggedOut: logoutDetails.casLoggedOut && logoutDetails.failedEndpoints.length === 0,
            storageCleaned: this.jar.size === 0,
            cookiesFlushed: this.jar.size === 0 && logoutDetails.casLoggedOut,
            logoutDetails,
            warnings: pulled.warnings.length > 0 ? pulled.warnings : undefined,
            steps,
          },
        },
      };
    } finally {
      if (!keepSession && !logoutCompleted) {
        await this.logoutAll(subAuth.session, detectedPrefix).catch(() => this.jar.wipe());
      }
    }
  }
}
