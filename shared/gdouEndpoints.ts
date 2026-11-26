/**
 * Single source of truth for all Guangdong Ocean University (GDOU)
 * CAS / WebVPN / 正方教务 (ZFSoft) endpoints and parameter variants.
 * Adapted from GDOU-haida-schedule (GPL-3.0).
 */

export const GDOU_ENTRY_URL = 'https://netcheck.gdou.edu.cn/go.php?code=jw';
export const GDOU_AUTH_ORIGIN = 'https://authserver.gdou.edu.cn';
export const GDOU_WFW_ORIGIN = 'https://wfw.gdou.edu.cn';
export const GDOU_AUTH_WFW_BASE = 'https://wfw.gdou.edu.cn/https://authserver.gdou.edu.cn';
export const GDOU_JW_DIRECT_ORIGIN = 'https://jw.gdou.edu.cn';
export const GDOU_JW_WFW_BASE = 'https://wfw.gdou.edu.cn/https://jw.gdou.edu.cn';
export const GDOU_JW_SSO_SERVICE = 'https://jw.gdou.edu.cn/sso/jziotlogin';

export const DEFAULT_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const GDOU_JW_PREFIXES = ['', '/jwglxt'] as const;

export const GDOU_JW_PATHS = {
  scheduleIndex: '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default',
  scheduleQuery: '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
  periodTimes: '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151',
  examQueries: [
    '/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105',
    '/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358110',
    '/kwgl/kscx_cxXsksxx.html?doType=query&gnmkdm=N358105',
  ] as const,
  gradeQueries: [
    '/cjcx/cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005',
    '/cjcx/cjcx_cxDgXscj.html?doType=query&gnmkdm=N305005',
  ] as const,
  emptyRoomQueries: [
    '/cdjy/cdjy_cxKxcdlb.html?doType=query&gnmkdm=N2155',
    '/cdjy/cdjy_cxKxcdlb.html?doType=query&gnmkdm=N215505',
  ] as const,
};

export const GDOU_AUTH_PATHS = {
  login: '/authserver/login',
  logout: '/authserver/logout',
  bfpInfo: '/authserver/bfp/info',
  checkNeedCaptcha: '/authserver/checkNeedCaptcha.htl',
  getCaptcha: '/authserver/getCaptcha.htl',
  changeReAuthType: '/authserver/reAuthCheck/changeReAuthType.do',
  getReAuthCode: '/authserver/dynamicCode/getDynamicCodeByReauth.do',
  reAuthSubmit: '/authserver/reAuthCheck/reAuthSubmit.do',
} as const;

export function buildExamParamVariants(
  xnm: string,
  xqm: string,
  timestampMs: number = Date.now()
): Record<string, string>[] {
  return [
    {
      xnm,
      xqm,
      ksmcdmb_id: '',
      kch: '',
      kc: '',
      ksrq: '',
      kkbm_id: '',
      _search: 'false',
      nd: String(timestampMs),
      'queryModel.showCount': '100',
      'queryModel.currentPage': '1',
      'queryModel.sortName': '',
      'queryModel.sortOrder': 'asc',
      time: '0',
    },
    {
      xnm,
      xqm: '',
      'queryModel.showCount': '100',
      'queryModel.currentPage': '1',
    },
    {
      xnm: '',
      xqm: '',
      'queryModel.showCount': '100',
      'queryModel.currentPage': '1',
    },
  ];
}

export function buildGradeQueryParams(
  timestampMs: number = Date.now()
): Record<string, string> {
  return {
    xnm: '',
    xqm: '',
    _search: 'false',
    nd: String(timestampMs),
    'queryModel.showCount': '5000',
    'queryModel.currentPage': '1',
    'queryModel.sortName': '',
    'queryModel.sortOrder': 'asc',
    time: '0',
  };
}
