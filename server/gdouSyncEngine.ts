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
} from '../shared/gdouEndpoints';
import { deriveCurrentTermParams } from '../shared/gdouTimetable';
import type {
  CourseItem,
  EmptyRoomItem,
  EphemeralCredentials,
  ExamItem,
  GradeItem,
  LogoutVerificationDetails,
  PeriodTime,
  SyncResultPayload,
} from '../shared/models';
import {
  computeTermWeek,
  getTodayDayOfWeek,
  parseZfEmptyRoomsResponse,
  parseZfExamResponse,
  parseZfGradesResponse,
  parseZfPeriodTimesResponse,
  parseZfScheduleResponse,
} from '../shared/parsers';
import { getDefaultTermStartDateForTerm } from '../shared/gdouTimetable';
import { sanitizeEndpointUrl } from '../shared/zeroRetentionSanitizer';
import {
  areCredentialsPurged,
  encryptGdouPassword,
  generateSecureHex,
  purgeEphemeralCredentials,
} from './cryptoAes';
import { EphemeralCookieJar } from './ephemeralCookieJar';

export interface PreparedAuthSession {
  entryFinalUrl: string;
  authOrigin: string;
  jwBaseUrl: string;
  isWebVpn: boolean;
  serviceUrl: string;
  pwdEncryptSalt: string;
  execution: string;
  lt: string;
  ephemeralBfp: string;
  alreadyLoggedIn: boolean;
}

export interface MfaChallengeState {
  required: true;
  reAuthUserId: string;
  serviceUrl: string;
  defaultReAuthType: '4' | '3';
  credentialsPurged: boolean;
  session: PreparedAuthSession;
  previousSteps: string[];
}

export interface WfwSubAuthState {
  required: true;
  username: string;
  salt2: string;
  execution2: string;
  lt2: string;
  needCaptcha: boolean;
  captchaImageUri?: string;
  session: PreparedAuthSession;
  previousSteps: string[];
}

export interface SyncTermOverride {
  xnm?: string;
  xqm?: string;
}

export type LoginSyncOutcome =
  | { status: 'completed'; result: SyncResultPayload }
  | { status: 'mfa_required'; mfa: MfaChallengeState }
  | { status: 'wfw_subauth_required'; subAuth: WfwSubAuthState };

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

const AUTH_ERROR_I18N: Record<string, string> = {
  accountLogin_account_pwd_error:
    '学号或「统一身份认证密码」错误（注意：不是旧教务密码，是海大微门户/网上办事大厅的密码）',
  accountLogin_captcha_error: '图形验证码错误，请刷新验证码后重试',
  accountLogin_account_locked: '账号已被临时锁定，请等待 15-30 分钟后再试',
  accountLogin_dynamic_code_error: '动态验证码错误或已过期，请重新获取',
};

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

const WFW_IP_BLOCKED_MSG =
  '海大微门户 (wfw.gdou.edu.cn) 当前限制了本服务器出口 IP（HTTP 403），因短时间内同步人数较多触发了学校防刷风控，请稍后再试或等待自动解封。';

function isUpstreamUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function buildUpstreamUnavailableMsg(status: number): string {
  return `海大官方微门户当前服务不可用（HTTP ${status}），属于学校服务器维护或波动，在校内可切校园网 Wi-Fi，校外请稍后再试`;
}

export async function prepareSession(jar: EphemeralCookieJar): Promise<PreparedAuthSession> {
  const ephemeralBfp = generateSecureHex(16);
  const netResp = await jar.fetch(GDOU_ENTRY_URL, {
    method: 'GET',
    headers: {
      'User-Agent': DEFAULT_DESKTOP_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeoutMs: 15_000,
  });

  const netHtml = await netResp.text();
  const isWebVpn = netResp.url.includes('wfw.gdou.edu.cn');
  if (isWebVpn && netResp.status === 403) {
    throw new Error(WFW_IP_BLOCKED_MSG);
  }
  if (isUpstreamUnavailableStatus(netResp.status)) {
    throw new Error(buildUpstreamUnavailableMsg(netResp.status));
  }
  const jwBaseUrl = isWebVpn ? GDOU_JW_WFW_BASE : GDOU_JW_DIRECT_ORIGIN;
  const serviceUrl = isWebVpn
    ? `${GDOU_WFW_ORIGIN}/`
    : extractServiceUrl(netHtml) || GDOU_JW_SSO_SERVICE;
  const authOrigin = GDOU_AUTH_ORIGIN;
  const authLoginUrl = `${authOrigin}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(serviceUrl)}`;

  jar.wipe();
  const authResp = await jar.fetch(authLoginUrl, {
    method: 'GET',
    headers: {
      'User-Agent': DEFAULT_DESKTOP_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const authHtml = await authResp.text();

  try {
    await jar.fetch(`${authOrigin}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${ephemeralBfp}`, {
      method: 'GET',
      headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
      timeoutMs: 10_000,
    });
  } catch {
    // non-fatal
  }

  const pwdEncryptSalt =
    extractHiddenInput(authHtml, 'pwdEncryptSalt') || extractHiddenInput(netHtml, 'pwdEncryptSalt');
  const execution =
    extractHiddenInput(authHtml, 'execution') || extractHiddenInput(netHtml, 'execution');
  const lt = extractHiddenInput(authHtml, 'lt') || extractHiddenInput(netHtml, 'lt');

  return {
    entryFinalUrl: authLoginUrl,
    authOrigin,
    jwBaseUrl,
    isWebVpn,
    serviceUrl,
    pwdEncryptSalt,
    execution,
    lt,
    ephemeralBfp,
    alreadyLoggedIn: false,
  };
}

export async function fetchCaptchaImage(
  jar: EphemeralCookieJar,
  baseOrigin: string,
  referer: string
): Promise<string | undefined> {
  const imgUrl = `${baseOrigin}${GDOU_AUTH_PATHS.getCaptcha}?${Date.now()}`;
  const resp = await jar.fetch(imgUrl, {
    method: 'GET',
    headers: {
      'User-Agent': DEFAULT_DESKTOP_UA,
      Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: referer,
    },
    timeoutMs: 12_000,
  });
  if (!resp.ok) return undefined;
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength < 64) return undefined;
  const rawType = resp.headers.get('content-type') || 'image/jpeg';
  const mimeType = rawType.split(';')[0].trim() || 'image/jpeg';
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

export async function checkCaptcha(
  jar: EphemeralCookieJar,
  session: PreparedAuthSession,
  username: string
): Promise<{ isNeed: boolean; imageDataUri?: string }> {
  const trimmed = username.trim();
  if (!trimmed) return { isNeed: false };
  const checkUrl = `${session.authOrigin}${GDOU_AUTH_PATHS.checkNeedCaptcha}?username=${encodeURIComponent(
    trimmed
  )}&_=${Date.now()}`;
  const resp = await jar.fetch(checkUrl, {
    method: 'GET',
    headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
    timeoutMs: 12_000,
  });
  if (!resp.ok) return { isNeed: false };
  const text = (await resp.text()).trim();
  if (!text.startsWith('{')) return { isNeed: false };
  const data = JSON.parse(text) as { isNeed?: boolean };
  if (!data.isNeed) return { isNeed: false };
  const imageDataUri = await fetchCaptchaImage(jar, session.authOrigin, session.entryFinalUrl);
  return { isNeed: true, imageDataUri };
}

async function logoutEphemeralSession(
  jar: EphemeralCookieJar,
  jwBaseUrl: string,
  authOrigin: string,
  isWebVpn: boolean,
  detectedPrefix = ''
): Promise<LogoutVerificationDetails> {
  const preLogoutUrls: string[] = [`${jwBaseUrl}${detectedPrefix}/logout`];
  if (isWebVpn) {
    preLogoutUrls.push(`${GDOU_WFW_ORIGIN}/logout`);
    if (authOrigin !== GDOU_AUTH_ORIGIN) {
      preLogoutUrls.push(`${authOrigin}${GDOU_AUTH_PATHS.logout}`);
    }
  }

  let attempted = 0;
  let succeeded = 0;
  const failedEndpoints: string[] = [];

  await Promise.all(
    preLogoutUrls.map(async (url) => {
      const safe = sanitizeEndpointUrl(url);
      attempted++;
      try {
        const resp = await jar.fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
          timeoutMs: 10_000,
        });
        if (resp.ok || (resp.status >= 300 && resp.status < 400)) succeeded++;
        else failedEndpoints.push(`${safe} (HTTP ${resp.status})`);
      } catch (err) {
        failedEndpoints.push(`${safe} (${err instanceof Error ? err.message : 'network error'})`);
      }
    })
  );

  const casLogoutUrl = `${GDOU_AUTH_ORIGIN}${GDOU_AUTH_PATHS.logout}`;
  attempted++;
  let casLoggedOut = false;
  try {
    const resp = await jar.fetch(casLogoutUrl, {
      method: 'GET',
      headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
      timeoutMs: 10_000,
    });
    if (resp.ok || (resp.status >= 300 && resp.status < 400)) {
      casLoggedOut = true;
      succeeded++;
    } else {
      failedEndpoints.push(`${sanitizeEndpointUrl(casLogoutUrl)} (HTTP ${resp.status})`);
    }
  } catch (err) {
    failedEndpoints.push(
      `${sanitizeEndpointUrl(casLogoutUrl)} (${err instanceof Error ? err.message : 'network error'})`
    );
  }

  jar.wipe();
  return { attempted, succeeded, casLoggedOut, failedEndpoints };
}

async function detectJwPrefixAndTerm(
  jar: EphemeralCookieJar,
  jwBaseUrl: string,
  override?: SyncTermOverride
) {
  const derived = deriveCurrentTermParams();
  let chosenPrefix = '';
  let detectedXnm = override?.xnm || '';
  let detectedXqm = override?.xqm || '';

  for (const prefix of GDOU_JW_PREFIXES) {
    try {
      const resp = await jar.fetch(`${jwBaseUrl}${prefix}${GDOU_JW_PATHS.scheduleIndex}`, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      if (html.includes('pwdEncryptSalt') || html.includes('统一身份认证平台')) continue;
      if (html.includes('xnm') || html.includes('xskbcx') || html.includes('课表')) {
        chosenPrefix = prefix;
        if (!detectedXnm) detectedXnm = parseSelectedOption(html, 'xnm') || '';
        if (!detectedXqm) detectedXqm = parseSelectedOption(html, 'xqm') || '';
        break;
      }
    } catch {
      // try next prefix
    }
  }

  const xnm = detectedXnm || derived.xnm;
  const xqm = detectedXqm || derived.xqm;
  const semText =
    xqm === '3' ? '第1学期' : xqm === '12' ? '第2学期' : xqm === '16' ? '第3学期' : '当前学期';
  const yearNum = parseInt(xnm, 10);
  const termLabel = Number.isFinite(yearNum)
    ? `${yearNum}-${yearNum + 1}学年 ${semText}`
    : derived.label;

  return { prefix: chosenPrefix, xnm, xqm, termLabel };
}

async function fetchScheduleJson(
  jar: EphemeralCookieJar,
  jwBaseUrl: string,
  prefix: string,
  xnm: string,
  xqm: string
): Promise<unknown> {
  const resp = await jar.fetch(`${jwBaseUrl}${prefix}${GDOU_JW_PATHS.scheduleQuery}`, {
    method: 'POST',
    headers: {
      'User-Agent': DEFAULT_DESKTOP_UA,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    },
    body: encodeFormBody({ xnm, xqm, kzlx: 'ck', xsdm: '' }),
  });
  const trimmed = (await resp.text()).trim();
  if (resp.status === 403) {
    throw new Error(WFW_IP_BLOCKED_MSG);
  }
  if (isUpstreamUnavailableStatus(resp.status)) {
    throw new Error(buildUpstreamUnavailableMsg(resp.status));
  }
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

async function fetchTodayEmptyRooms(
  jar: EphemeralCookieJar,
  jwBaseUrl: string,
  prefix: string,
  xnm: string,
  xqm: string,
  campusId?: string
): Promise<EmptyRoomItem[]> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateText = `${y}-${m}-${d}`;
  const startDate = getDefaultTermStartDateForTerm(xnm, xqm) ?? `${y}-09-01`;
  const week = Math.min(20, Math.max(1, computeTermWeek(startDate, now)));
  const dayOfWeek = getTodayDayOfWeek(now);
  const zcdMask = String(1 << (week - 1));

  // Major 2-section blocks: 1-2 (bitmask 3), 3-4 (12), 5-6 (48), 7-8 (192), 9-10 (768)
  const slots = [
    { label: '1-2节', jcd: '3' },
    { label: '3-4节', jcd: '12' },
    { label: '5-6节', jcd: '48' },
    { label: '7-8节', jcd: '192' },
    { label: '9-10节', jcd: '768' },
  ];

  const allRooms: EmptyRoomItem[] = [];
  let workingEndpoint: string | null = null;

  for (const slot of slots) {
    const candidates: string[] = workingEndpoint
      ? [workingEndpoint]
      : GDOU_JW_PATHS.emptyRoomQueries.map((p) => `${jwBaseUrl}${prefix}${p}`);

    for (const endpoint of candidates) {
      try {
        const resp = await jar.fetch(endpoint, {
          method: 'POST',
          headers: {
            'User-Agent': DEFAULT_DESKTOP_UA,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: encodeFormBody({
            fwzt: 'cx',
            xqh_id: campusId || '1',
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
        const txt = (await resp.text()).trim();
        if (!txt.startsWith('{') && !txt.startsWith('[')) continue;
        const parsed = parseZfEmptyRoomsResponse(JSON.parse(txt), slot.label, dateText);
        if (parsed.length > 0) {
          workingEndpoint = endpoint;
          allRooms.push(...parsed);
          break;
        }
      } catch {
        // best-effort non-fatal
      }
    }
    if (!workingEndpoint && slot.label === '1-2节') {
      // Try one more slot (3-4节) before giving up if first slot returned empty
      continue;
    }
  }
  return allRooms;
}

async function pullAllJwData(
  jar: EphemeralCookieJar,
  session: PreparedAuthSession,
  steps: string[],
  termOverride?: SyncTermOverride
): Promise<{
  prefix: string;
  courses: CourseItem[];
  exams: ExamItem[];
  grades: GradeItem[];
  emptyRooms: EmptyRoomItem[];
  syncedPeriods?: PeriodTime[];
  detectedCampus?: string;
  termLabel: string;
  academicYear: string;
  semesterCode: string;
  warnings: string[];
}> {
  const warnings: string[] = [];
  let { prefix, xnm, xqm, termLabel } = await detectJwPrefixAndTerm(
    jar,
    session.jwBaseUrl,
    termOverride
  );
  steps.push(`5. 已锁定目标学期：${termLabel} (xnm=${xnm}, xqm=${xqm})`);

  let rawSchedule: unknown;
  try {
    rawSchedule = await fetchScheduleJson(jar, session.jwBaseUrl, prefix, xnm, xqm);
  } catch {
    const retryBase = session.isWebVpn ? GDOU_AUTH_WFW_BASE : session.authOrigin;
    await jar.fetch(
      `${retryBase}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
      { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
    );
    const redetected = await detectJwPrefixAndTerm(jar, session.jwBaseUrl, termOverride);
    prefix = redetected.prefix;
    xnm = redetected.xnm;
    xqm = redetected.xqm;
    termLabel = redetected.termLabel;
    rawSchedule = await fetchScheduleJson(jar, session.jwBaseUrl, prefix, xnm, xqm);
  }

  let parsedSchedule = parseZfScheduleResponse(rawSchedule);

  if (parsedSchedule.courses.length === 0 && !termOverride?.xnm && !termOverride?.xqm) {
    const y = parseInt(xnm, 10);
    if (Number.isFinite(y)) {
      const prev =
        xqm === '3'
          ? { xnm: String(y - 1), xqm: '12', label: `${y - 1}-${y}学年 第2学期` }
          : { xnm: String(y), xqm: '3', label: `${y}-${y + 1}学年 第1学期` };
      try {
        const prevRaw = await fetchScheduleJson(jar, session.jwBaseUrl, prefix, prev.xnm, prev.xqm);
        const prevParsed = parseZfScheduleResponse(prevRaw);
        if (prevParsed.courses.length > 0) {
          xnm = prev.xnm;
          xqm = prev.xqm;
          termLabel = prevParsed.termLabel || prev.label;
          parsedSchedule = prevParsed;
          steps.push(`5b. 当前学期暂无排课，已自动回退至上一学期：${termLabel}`);
        }
      } catch {
        // ignore fallback error
      }
    }
  }
  if (parsedSchedule.warnings.length > 0) warnings.push(...parsedSchedule.warnings);

  // Period times
  let syncedPeriods: PeriodTime[] = [];
  const periodVariants: Record<string, string>[] = [
    { xnm, xqm, xqh_id: parsedSchedule.campusId || '1' },
    { xnm, xqm },
  ];
  for (const params of periodVariants) {
    try {
      const resp = await jar.fetch(`${session.jwBaseUrl}${prefix}${GDOU_JW_PATHS.periodTimes}`, {
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
      const t = (await resp.text()).trim();
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

  steps.push(
    syncedPeriods.length >= 8
      ? `6. 课表解析完成：共 ${parsedSchedule.courses.length} 项课程（已同步官方 ${syncedPeriods.length} 节作息）`
      : `6. 课表解析完成：共 ${parsedSchedule.courses.length} 项课程`
  );

  // Exams
  let examData: unknown = { items: [] };
  let examAttempts = 0;
  examLoop: for (const p of GDOU_JW_PATHS.examQueries) {
    for (const bodyParams of buildExamParamVariants(xnm, xqm)) {
      if (examAttempts >= 4) break examLoop;
      examAttempts++;
      try {
        const resp = await jar.fetch(`${session.jwBaseUrl}${prefix}${p}`, {
          method: 'POST',
          headers: {
            'User-Agent': DEFAULT_DESKTOP_UA,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: encodeFormBody(bodyParams),
        });
        if (!resp.ok) continue;
        const txt = (await resp.text()).trim();
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
        // try next
      }
    }
  }
  const exams = parseZfExamResponse(examData);

  // Grades
  let gradeData: unknown = { items: [] };
  const gradeBody = encodeFormBody(buildGradeQueryParams());
  for (const p of GDOU_JW_PATHS.gradeQueries) {
    try {
      const resp = await jar.fetch(`${session.jwBaseUrl}${prefix}${p}`, {
        method: 'POST',
        headers: {
          'User-Agent': DEFAULT_DESKTOP_UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: gradeBody,
      });
      if (!resp.ok) continue;
      const txt = (await resp.text()).trim();
      if (txt.startsWith('{')) {
        gradeData = JSON.parse(txt);
        break;
      }
    } catch {
      // try next
    }
  }
  const grades = parseZfGradesResponse(gradeData);
  // Skip automatic 5-slot empty-room burst during main sync to minimize WFW rate-limit risk
  const emptyRooms: EmptyRoomItem[] = [];
  steps.push(
    `7. 考试与成绩拉取完成：考试 ${exams.length} 场、历史成绩 ${grades.length} 门`
  );

  return {
    prefix,
    courses: parsedSchedule.courses,
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

async function completeCasToJwHandoff(
  jar: EphemeralCookieJar,
  session: PreparedAuthSession,
  needWfwActivation: boolean,
  ephemeralForWfw: { username: string; password: string } | undefined,
  previousSteps: string[]
): Promise<
  | { status: 'ready' }
  | { status: 'wfw_subauth_needed'; salt2: string; execution2: string; lt2: string }
  | { status: 'mfa_required'; mfa: MfaChallengeState }
> {
  if (session.isWebVpn) {
    if (session.authOrigin === GDOU_AUTH_WFW_BASE) {
      await jar.fetch(
        `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
        { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
      );
      return { status: 'ready' };
    }

    if (needWfwActivation) {
      await jar
        .fetch(
          `${GDOU_AUTH_ORIGIN}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(`${GDOU_WFW_ORIGIN}/`)}`,
          { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
        )
        .catch(() => undefined);
    }

    const jwEntryResp = await jar.fetch(GDOU_JW_WFW_BASE, {
      method: 'GET',
      headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
    });
    if (jwEntryResp.status === 403) {
      throw new Error(WFW_IP_BLOCKED_MSG);
    }
    const jwEntryHtml = await jwEntryResp.text();
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
      const authWfwResp = await jar.fetch(
        `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
        { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
      );
      if (authWfwResp.ok) {
        const html = await authWfwResp.text();
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
    if (!ephemeralForWfw?.username || !ephemeralForWfw?.password) {
      return { status: 'wfw_subauth_needed', salt2, execution2: exe2, lt2 };
    }

    await jar
      .fetch(`${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${session.ephemeralBfp}`, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
      })
      .catch(() => undefined);

    const encryptedPwd2 = encryptGdouPassword(ephemeralForWfw.password, salt2);
    const wfwAuthPostUrl = `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(
      GDOU_JW_SSO_SERVICE
    )}`;
    const wfwPostResp = await jar.fetch(wfwAuthPostUrl, {
      method: 'POST',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: GDOU_WFW_ORIGIN,
        Referer: wfwAuthPostUrl,
      },
      body: encodeFormBody({
        username: ephemeralForWfw.username,
        password: encryptedPwd2,
        captcha: '',
        _eventId: 'submit',
        cllt: 'userNameLogin',
        dllt: 'generalLogin',
        lt: lt2,
        execution: exe2,
      }),
    });

    const wfwPostHtml = await wfwPostResp.text();
    if (isAccountLockedMessage(wfwPostHtml)) {
      throw new Error('检测到海大账号已触发临时锁定保护，已立即熔断停止所有请求。');
    }
    if (
      wfwPostResp.url.includes('reAuthLoginView.do') ||
      wfwPostHtml.includes('reAuthParams') ||
      wfwPostHtml.includes('多因子认证')
    ) {
      const userIdMatch = wfwPostHtml.match(/"reAuthUserId"\s*:\s*"([^"]+)"/);
      const typeMatch = wfwPostHtml.match(/"reAuthType"\s*:\s*"([34])"/);
      return {
        status: 'mfa_required',
        mfa: {
          required: true,
          reAuthUserId: userIdMatch ? userIdMatch[1] : ephemeralForWfw.username,
          serviceUrl: GDOU_JW_SSO_SERVICE,
          defaultReAuthType: (typeMatch?.[1] as '4' | '3') || '4',
          credentialsPurged: true,
          session: {
            ...session,
            authOrigin: GDOU_AUTH_WFW_BASE,
            serviceUrl: GDOU_JW_SSO_SERVICE,
          },
          previousSteps,
        },
      };
    }
    if (wfwPostHtml.includes('pwdEncryptSalt')) {
      const tip = extractAuthError(wfwPostHtml);
      throw new Error(tip || `校外教务通道二次握手未通过 (HTTP ${wfwPostResp.status})`);
    }
    return { status: 'ready' };
  }

  await jar.fetch(
    `${session.authOrigin}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(GDOU_JW_SSO_SERVICE)}`,
    { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
  );
  return { status: 'ready' };
}

export interface EncryptedCredentials {
  username: string;
  encryptedPassword?: string;
  password?: string; // legacy local fallback only
  captcha?: string;
}

export async function executeDirectLoginSync(
  jar: EphemeralCookieJar,
  session: PreparedAuthSession,
  credentials: EncryptedCredentials,
  termOverride?: SyncTermOverride
): Promise<LoginSyncOutcome> {
  const steps: string[] = [];
  let keepSession = false;
  let logoutCompleted = false;
  let detectedPrefix = '';
  let rawPassword = credentials.password ?? '';
  let preEncrypted = (credentials.encryptedPassword ?? '').trim();
  const username = credentials.username.trim();
  const captcha = (credentials.captcha ?? '').trim();

  try {
    steps.push(
      session.isWebVpn
        ? '1. 已接入海大认证中心与校外微门户通道 (wfw.gdou.edu.cn，免校园网)'
        : '1. 已接入海大校园网直连通道 (jw.gdou.edu.cn)'
    );
    credentials.username = '';
    credentials.password = '';
    credentials.encryptedPassword = '';
    credentials.captcha = '';

    const loginAction = `${session.authOrigin}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(
      session.serviceUrl
    )}`;
    const encryptedPwd = preEncrypted || encryptGdouPassword(rawPassword, session.pwdEncryptSalt);
    preEncrypted = '';
    steps.push(
      rawPassword
        ? '2. 密码已完成 AES-128-CBC (CSPRNG) 加密，正在提交统一身份认证...'
        : '2. 已接收浏览器端 AES-128-CBC 密文（服务器全程零明文密码），正在提交海大认证...'
    );

    const loginResp = await jar.fetch(loginAction, {
      method: 'POST',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: session.authOrigin,
        Referer: loginAction,
      },
      body: encodeFormBody({
        username,
        password: encryptedPwd,
        captcha,
        _eventId: 'submit',
        cllt: 'userNameLogin',
        dllt: 'generalLogin',
        lt: session.lt,
        execution: session.execution,
      }),
    });

    const loginHtml = await loginResp.text();

    if (
      loginResp.url.includes('reAuthLoginView.do') ||
      loginHtml.includes('reAuthParams') ||
      loginHtml.includes('多因子认证')
    ) {
      keepSession = true;
      rawPassword = '';
      const userIdMatch = loginHtml.match(/"reAuthUserId"\s*:\s*"([^"]+)"/);
      const typeMatch = loginHtml.match(/"reAuthType"\s*:\s*"([34])"/);
      steps.push('3. 账号密码验证通过（密码内存引用已释放），需完成多因子安全验证');
      return {
        status: 'mfa_required',
        mfa: {
          required: true,
          reAuthUserId: userIdMatch ? userIdMatch[1] : username,
          serviceUrl: session.serviceUrl,
          defaultReAuthType: (typeMatch?.[1] as '4' | '3') || '4',
          credentialsPurged: areCredentialsPurged(credentials) && rawPassword === '',
          session,
          previousSteps: steps,
        },
      };
    }

    if (isAccountLockedMessage(loginHtml)) {
      rawPassword = '';
      throw new Error('检测到海大账号已触发临时锁定保护，已立即熔断停止请求。');
    }

    if (
      loginHtml.includes('pwdEncryptSalt') &&
      (loginHtml.includes('pwdFromId') || loginHtml.includes('loginFromId'))
    ) {
      rawPassword = '';
      throw new Error(extractAuthError(loginHtml) || '学号、密码或验证码错误，请核对后重试');
    }

    steps.push('3. 海大统一身份认证通过，正在打通教务系统会话...');
    const alreadyOnJw =
      loginResp.url.includes('jw.gdou.edu.cn') &&
      !loginHtml.includes('pwdEncryptSalt') &&
      !loginHtml.includes('reAuthParams');
    const needWfwActivation = session.isWebVpn && !loginResp.url.includes('wfw.gdou.edu.cn');
    const handoffSecret =
      session.isWebVpn && rawPassword ? { username, password: rawPassword } : undefined;
    rawPassword = '';

    let handoffOutcome: Awaited<ReturnType<typeof completeCasToJwHandoff>> = { status: 'ready' };
    try {
      if (!alreadyOnJw) {
        handoffOutcome = await completeCasToJwHandoff(
          jar,
          session,
          needWfwActivation,
          handoffSecret,
          steps
        );
      }
    } finally {
      if (handoffSecret) {
        handoffSecret.username = '';
        handoffSecret.password = '';
      }
    }

    if (handoffOutcome.status === 'mfa_required') {
      keepSession = true;
      steps.push('4. 校外教务通道要求完成多因子二次验证');
      return { status: 'mfa_required', mfa: handoffOutcome.mfa };
    }

    if (handoffOutcome.status === 'wfw_subauth_needed') {
      keepSession = true;
      let needCaptcha = false;
      let captchaImageUri: string | undefined;
      try {
        const capResp = await jar.fetch(
          `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.checkNeedCaptcha}?username=${encodeURIComponent(
            username
          )}&_=${Date.now()}`,
          { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
        );
        const capTxt = (await capResp.text()).trim();
        if (capTxt.startsWith('{') && (JSON.parse(capTxt) as { isNeed?: boolean }).isNeed) {
          needCaptcha = true;
          captchaImageUri = await fetchCaptchaImage(
            jar,
            GDOU_AUTH_WFW_BASE,
            `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}`
          );
        }
      } catch {
        // ignore
      }
      steps.push('4. 校外微门户已激活，等待浏览器端使用子会话盐值本地加密完成第二步握手');
      return {
        status: 'wfw_subauth_required',
        subAuth: {
          required: true,
          username,
          salt2: handoffOutcome.salt2,
          execution2: handoffOutcome.execution2,
          lt2: handoffOutcome.lt2,
          needCaptcha,
          captchaImageUri,
          session,
          previousSteps: steps,
        },
      };
    }

    steps.push('4. 教务通道已激活，本地内存凭据引用已清空');
    const pulled = await pullAllJwData(jar, session, steps, termOverride);
    detectedPrefix = pulled.prefix;

    const logoutDetails = await logoutEphemeralSession(
      jar,
      session.jwBaseUrl,
      session.authOrigin,
      session.isWebVpn,
      detectedPrefix
    );
    logoutCompleted = true;

    const sessionLoggedOut = logoutDetails.casLoggedOut && logoutDetails.failedEndpoints.length === 0;
    steps.push(
      `8. 服务端会话已注销（${logoutDetails.succeeded}/${logoutDetails.attempted} 项确认），内存 Cookie 已销毁`
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
          credentialsPurged: areCredentialsPurged(credentials) && rawPassword === '',
          sessionLoggedOut,
          storageCleaned: jar.size === 0,
          cookiesFlushed: jar.size === 0 && logoutDetails.casLoggedOut,
          logoutDetails,
          warnings: pulled.warnings.length > 0 ? pulled.warnings : undefined,
          steps,
        },
      },
    };
  } finally {
    rawPassword = '';
    purgeEphemeralCredentials(credentials);
    if (!keepSession && !logoutCompleted) {
      await logoutEphemeralSession(
        jar,
        session.jwBaseUrl,
        session.authOrigin,
        session.isWebVpn,
        detectedPrefix
      ).catch(() => jar.wipe());
    }
  }
}

export async function sendMfaCode(
  jar: EphemeralCookieJar,
  mfa: MfaChallengeState,
  reAuthType: '4' | '3'
): Promise<string> {
  const origin = mfa.session.authOrigin;
  await jar
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
        service: mfa.serviceUrl,
      }),
    })
    .catch(() => undefined);

  const authCodeTypeName =
    reAuthType === '4' ? 'reAuthWChatDynamicCodeType' : 'reAuthDynamicCodeType';

  const resp = await jar.fetch(`${origin}${GDOU_AUTH_PATHS.getReAuthCode}`, {
    method: 'POST',
    headers: {
      'User-Agent': DEFAULT_DESKTOP_UA,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: encodeFormBody({
      userName: mfa.reAuthUserId,
      authCodeTypeName,
    }),
  });
  if (!resp.ok) throw new Error(`发送多因子验证码失败 (HTTP ${resp.status})`);
  const rawText = (await resp.text()).trim();
  let data: { returnMessage?: string; mobile?: string } = {};
  if (rawText.startsWith('{')) {
    try {
      data = JSON.parse(rawText) as { returnMessage?: string; mobile?: string };
    } catch {
      // ignore
    }
  }
  return (
    [data.returnMessage, data.mobile].filter(Boolean).join(' ') ||
    (reAuthType === '4' ? '企业微信验证码已发送，请查收' : '短信验证码已发送，请查收')
  );
}

export async function submitMfaAndSync(
  jar: EphemeralCookieJar,
  mfa: MfaChallengeState,
  dynamicCode: string,
  reAuthType: '4' | '3',
  termOverride?: SyncTermOverride
): Promise<LoginSyncOutcome> {
  const steps = [...mfa.previousSteps];
  let keepSession = false;
  let logoutCompleted = false;
  let detectedPrefix = '';

  try {
    const origin = mfa.session.authOrigin;
    // Bind ephemeralBfp right before reAuthSubmit so skipTmpReAuth=true trusts this device fingerprint!
    await jar
      .fetch(`${origin}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${mfa.session.ephemeralBfp}`, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
        timeoutMs: 10_000,
      })
      .catch(() => undefined);

    const resp = await jar.fetch(`${origin}${GDOU_AUTH_PATHS.reAuthSubmit}`, {
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

    const text = (await resp.text()).trim();
    if (text.startsWith('{')) {
      const data = JSON.parse(text) as { code?: string; msg?: string };
      if (data.code === 'reAuth_failed' || data.code === 'reAuth_unauthorized') {
        throw new Error(data.msg || '二次认证验证码错误或已过期，请重新输入');
      }
    }

    steps.push('4. 多因子二次认证通过，正在激活教务系统票据...');
    const handoff = await completeCasToJwHandoff(jar, mfa.session, mfa.session.isWebVpn, undefined, steps);

    if (handoff.status === 'mfa_required') {
      keepSession = true;
      return { status: 'mfa_required', mfa: handoff.mfa };
    }
    if (handoff.status === 'wfw_subauth_needed') {
      keepSession = true;
      let needCaptcha = false;
      let captchaImageUri: string | undefined;
      try {
        const capResp = await jar.fetch(
          `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.checkNeedCaptcha}?username=${encodeURIComponent(
            mfa.reAuthUserId
          )}&_=${Date.now()}`,
          { method: 'GET', headers: { 'User-Agent': DEFAULT_DESKTOP_UA } }
        );
        const capTxt = (await capResp.text()).trim();
        if (capTxt.startsWith('{') && (JSON.parse(capTxt) as { isNeed?: boolean }).isNeed) {
          needCaptcha = true;
          captchaImageUri = await fetchCaptchaImage(
            jar,
            GDOU_AUTH_WFW_BASE,
            `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}`
          );
        }
      } catch {
        // ignore
      }
      steps.push('5. 校外微门户已就绪，因零留存未缓存密码，请重新输入一次密码激活教务子会话');
      return {
        status: 'wfw_subauth_required',
        subAuth: {
          required: true,
          username: mfa.reAuthUserId,
          salt2: handoff.salt2,
          execution2: handoff.execution2,
          lt2: handoff.lt2,
          needCaptcha,
          captchaImageUri,
          session: mfa.session,
          previousSteps: steps,
        },
      };
    }

    const pulled = await pullAllJwData(jar, mfa.session, steps, termOverride);
    detectedPrefix = pulled.prefix;
    const logoutDetails = await logoutEphemeralSession(
      jar,
      mfa.session.jwBaseUrl,
      mfa.session.authOrigin,
      mfa.session.isWebVpn,
      detectedPrefix
    );
    logoutCompleted = true;

    const sessionLoggedOut = logoutDetails.casLoggedOut && logoutDetails.failedEndpoints.length === 0;
    steps.push(
      `8. 服务端会话已注销（${logoutDetails.succeeded}/${logoutDetails.attempted} 项确认），内存 Cookie 已销毁`
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
          credentialsPurged: true,
          sessionLoggedOut,
          storageCleaned: jar.size === 0,
          cookiesFlushed: jar.size === 0 && logoutDetails.casLoggedOut,
          logoutDetails,
          warnings: pulled.warnings.length > 0 ? pulled.warnings : undefined,
          steps,
        },
      },
    };
  } finally {
    if (!keepSession && !logoutCompleted) {
      await logoutEphemeralSession(
        jar,
        mfa.session.jwBaseUrl,
        mfa.session.authOrigin,
        mfa.session.isWebVpn,
        detectedPrefix
      ).catch(() => jar.wipe());
    }
  }
}

export async function completeWfwSubAuthSync(
  jar: EphemeralCookieJar,
  subAuth: WfwSubAuthState,
  credentials: EncryptedCredentials,
  termOverride?: SyncTermOverride
): Promise<LoginSyncOutcome> {
  const steps = [...subAuth.previousSteps];
  let keepSession = false;
  let logoutCompleted = false;
  let detectedPrefix = '';
  let rawPassword = credentials.password ?? '';
  let preEncrypted = (credentials.encryptedPassword ?? '').trim();
  const username = (credentials.username || subAuth.username).trim();
  const captcha = (credentials.captcha ?? '').trim();

  try {
    credentials.username = '';
    credentials.password = '';
    credentials.encryptedPassword = '';
    credentials.captcha = '';
    const encryptedPwd2 = preEncrypted || encryptGdouPassword(rawPassword, subAuth.salt2);
    rawPassword = '';
    preEncrypted = '';

    // Bind the already MFA-trusted ephemeralBfp on GDOU_AUTH_WFW_BASE so Phase 2 skips redundant MFA!
    await jar
      .fetch(`${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${subAuth.session.ephemeralBfp}`, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
        timeoutMs: 10_000,
      })
      .catch(() => undefined);

    const wfwAuthPostUrl = `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}?service=${encodeURIComponent(
      GDOU_JW_SSO_SERVICE
    )}`;
    const resp = await jar.fetch(wfwAuthPostUrl, {
      method: 'POST',
      headers: {
        'User-Agent': DEFAULT_DESKTOP_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: GDOU_WFW_ORIGIN,
        Referer: wfwAuthPostUrl,
      },
      body: encodeFormBody({
        username,
        password: encryptedPwd2,
        captcha,
        _eventId: 'submit',
        cllt: 'userNameLogin',
        dllt: 'generalLogin',
        lt: subAuth.lt2,
        execution: subAuth.execution2,
      }),
    });

    const html = await resp.text();
    if (isAccountLockedMessage(html)) {
      throw new Error('检测到海大账号已触发临时锁定保护，已立即熔断停止请求。');
    }
    if (
      resp.url.includes('reAuthLoginView.do') ||
      html.includes('reAuthParams') ||
      html.includes('多因子认证')
    ) {
      keepSession = true;
      await jar
        .fetch(`${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.bfpInfo}?bfp=${subAuth.session.ephemeralBfp}`, {
          method: 'GET',
          headers: { 'User-Agent': DEFAULT_DESKTOP_UA },
          timeoutMs: 10_000,
        })
        .catch(() => undefined);
      const userIdMatch = html.match(/"reAuthUserId"\s*:\s*"([^"]+)"/);
      const typeMatch = html.match(/"reAuthType"\s*:\s*"([34])"/);
      return {
        status: 'mfa_required',
        mfa: {
          required: true,
          reAuthUserId: userIdMatch ? userIdMatch[1] : username,
          serviceUrl: GDOU_JW_SSO_SERVICE,
          defaultReAuthType: (typeMatch?.[1] as '4' | '3') || '4',
          credentialsPurged: true,
          session: {
            ...subAuth.session,
            authOrigin: GDOU_AUTH_WFW_BASE,
            serviceUrl: GDOU_JW_SSO_SERVICE,
          },
          previousSteps: steps,
        },
      };
    }
    if (html.includes('pwdEncryptSalt')) {
      throw new Error(extractAuthError(html) || `校外教务子会话验证未通过 (HTTP ${resp.status})`);
    }

    const pulled = await pullAllJwData(jar, subAuth.session, steps, termOverride);
    detectedPrefix = pulled.prefix;

    const logoutDetails = await logoutEphemeralSession(
      jar,
      subAuth.session.jwBaseUrl,
      subAuth.session.authOrigin,
      subAuth.session.isWebVpn,
      detectedPrefix
    );
    logoutCompleted = true;

    const sessionLoggedOut = logoutDetails.casLoggedOut && logoutDetails.failedEndpoints.length === 0;
    steps.push(
      `8. 服务端会话已注销（${logoutDetails.succeeded}/${logoutDetails.attempted} 项确认），内存 Cookie 已销毁`
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
          credentialsPurged: areCredentialsPurged(credentials) && rawPassword === '',
          sessionLoggedOut,
          storageCleaned: jar.size === 0,
          cookiesFlushed: jar.size === 0 && logoutDetails.casLoggedOut,
          logoutDetails,
          warnings: pulled.warnings.length > 0 ? pulled.warnings : undefined,
          steps,
        },
      },
    };
  } finally {
    rawPassword = '';
    purgeEphemeralCredentials(credentials);
    if (!keepSession && !logoutCompleted) {
      await logoutEphemeralSession(
        jar,
        subAuth.session.jwBaseUrl,
        subAuth.session.authOrigin,
        subAuth.session.isWebVpn,
        detectedPrefix
      ).catch(() => jar.wipe());
    }
  }
}
