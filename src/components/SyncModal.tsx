import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';
import { deriveCurrentTermParams } from '../../shared/gdouTimetable';
import type { SyncResultPayload } from '../../shared/models';
import { encryptGdouPasswordInBrowser } from '../services/clientCrypto';
import { DirectMobileSyncSession } from '../services/directGdouClient';
import { isNativeMobileApp } from '../services/nativeHttpBridge';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncCompleted: (result: SyncResultPayload) => void;
}

type ModalStep = 'preparing' | 'login' | 'mfa' | 'wfw_subauth' | 'done';

export const SyncModal: React.FC<SyncModalProps> = ({ isOpen, onClose, onSyncCompleted }) => {
  const isNative = isNativeMobileApp();
  const nativeSessionRef = useRef<DirectMobileSyncSession | null>(null);

  const [step, setStep] = useState<ModalStep>('preparing');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pwdSalt, setPwdSalt] = useState<string>('');
  const [salt2, setSalt2] = useState<string>('');
  const [networkRoute, setNetworkRoute] = useState<'wfw-webvpn' | 'campus-direct'>('wfw-webvpn');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Login fields (never persisted anywhere)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const ephemeralPwdRef = useRef<string>('');
  const [captcha, setCaptcha] = useState('');
  const [captchaUri, setCaptchaUri] = useState<string | undefined>(undefined);

  // Optional term override
  const defaultTerm = deriveCurrentTermParams();
  const [xnm, setXnm] = useState(defaultTerm.xnm);
  const [xqm, setXqm] = useState(defaultTerm.xqm);

  // MFA fields
  const [reAuthType, setReAuthType] = useState<'4' | '3'>('4');
  const [dynamicCode, setDynamicCode] = useState('');
  const [mfaNotice, setMfaNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Result receipt
  const [completedResult, setCompletedResult] = useState<SyncResultPayload | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const initSession = async () => {
    setStep('preparing');
    setError(null);
    setPassword('');
    setCaptcha('');
    setCaptchaUri(undefined);
    setDynamicCode('');
    setMfaNotice('');
    setCompletedResult(null);

    if (isNative) {
      nativeSessionRef.current?.destroy();
      const s = new DirectMobileSyncSession();
      nativeSessionRef.current = s;
      try {
        const res = await s.prepare();
        setSessionId('native-direct');
        setPwdSalt(res.pwdEncryptSalt);
        setSalt2('');
        setNetworkRoute(res.networkRoute);
        setStep('login');
      } catch (err) {
        setError(err instanceof Error ? err.message : '手机直连海大教务通道失败，请检查网络');
        setStep('login');
      }
      return;
    }

    try {
      const resp = await fetch('/api/sync/prepare', { method: 'POST' });
      const data = (await resp.json()) as {
        sessionId?: string;
        networkRoute?: 'wfw-webvpn' | 'campus-direct';
        pwdEncryptSalt?: string;
        error?: string;
      };
      if (!resp.ok || !data.sessionId) {
        throw new Error(data.error || '无法连接到同步服务，请稍后重试');
      }
      setSessionId(data.sessionId);
      setPwdSalt(data.pwdEncryptSalt ?? '');
      setSalt2('');
      setNetworkRoute(data.networkRoute ?? 'wfw-webvpn');
      setStep('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化教务通道失败');
      setStep('login');
    }
  };

  useEffect(() => {
    if (isOpen) {
      void initSession();
    }
    return () => {
      nativeSessionRef.current?.destroy();
      nativeSessionRef.current = null;
      ephemeralPwdRef.current = '';
      setPassword('');
      setDynamicCode('');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    if (isNative) {
      nativeSessionRef.current?.destroy();
      nativeSessionRef.current = null;
    } else if (sessionId) {
      fetch('/api/sync/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => undefined);
    }
    ephemeralPwdRef.current = '';
    setPassword('');
    setDynamicCode('');
    setSessionId(null);
    onClose();
  };

  const handleCheckCaptcha = async (forceRefresh = false) => {
    if (!sessionId || (!username.trim() && !forceRefresh)) return;
    try {
      if (isNative && nativeSessionRef.current) {
        const data = await nativeSessionRef.current.checkCaptcha(username.trim(), forceRefresh);
        if (data.isNeed && data.imageDataUri) setCaptchaUri(data.imageDataUri);
        else if (!forceRefresh) setCaptchaUri(undefined);
        return;
      }
      const resp = await fetch('/api/sync/captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, username: username.trim(), forceRefresh }),
      });
      const data = (await resp.json()) as { isNeed?: boolean; imageDataUri?: string };
      if (data.isNeed && data.imageDataUri) setCaptchaUri(data.imageDataUri);
      else if (!forceRefresh) setCaptchaUri(undefined);
    } catch {
      // ignore non-fatal probe error
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) {
      setError('通道未就绪，请先点击“重连”');
      return;
    }
    setBusy(true);
    setError(null);
    let pwdSnapshot = password;
    setPassword('');

    try {
      if (isNative && nativeSessionRef.current) {
        const outcome = await nativeSessionRef.current.login(
          username.trim(),
          pwdSnapshot,
          captcha.trim(),
          xnm,
          xqm
        );
        if (outcome.status === 'mfa_required') {
          ephemeralPwdRef.current = pwdSnapshot;
          pwdSnapshot = '';
          setReAuthType(outcome.mfa.defaultReAuthType);
          setCooldown(0);
          setMfaNotice('');
          setStep('mfa');
          return;
        }
        if (outcome.status === 'wfw_subauth_required') {
          ephemeralPwdRef.current = '';
          pwdSnapshot = '';
          setSalt2(outcome.subAuth.salt2);
          setCaptcha('');
          setCaptchaUri(outcome.subAuth.needCaptcha ? outcome.subAuth.captchaImageUri : undefined);
          setStep('wfw_subauth');
          return;
        }
        pwdSnapshot = '';
        ephemeralPwdRef.current = '';
        setCompletedResult(outcome.result);
        setStep('done');
        onSyncCompleted(outcome.result);
        return;
      }

      const encryptedPassword = encryptGdouPasswordInBrowser(pwdSnapshot, pwdSalt);
      const resp = await fetch('/api/sync/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          username: username.trim(),
          encryptedPassword,
          captcha: captcha.trim(),
          xnm,
          xqm,
        }),
      });
      const data = (await resp.json()) as {
        status?: string;
        defaultReAuthType?: '4' | '3';
        salt2?: string;
        needCaptcha?: boolean;
        captchaImageUri?: string;
        result?: SyncResultPayload;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || '登录验证失败');

      if (data.status === 'mfa_required') {
        ephemeralPwdRef.current = pwdSnapshot;
        pwdSnapshot = '';
        setReAuthType(data.defaultReAuthType || '4');
        setCooldown(0);
        setMfaNotice('');
        setStep('mfa');
        return;
      }

      if (data.status === 'wfw_subauth_required') {
        const subSalt = data.salt2 ?? '';
        setSalt2(subSalt);
        if (!data.needCaptcha && subSalt && pwdSnapshot) {
          const encryptedPassword2 = encryptGdouPasswordInBrowser(pwdSnapshot, subSalt);
          pwdSnapshot = '';
          const resp2 = await fetch('/api/sync/wfw-subauth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              encryptedPassword: encryptedPassword2,
              captcha: '',
              xnm,
              xqm,
            }),
          });
          const data2 = (await resp2.json()) as {
            status?: string;
            defaultReAuthType?: '4' | '3';
            result?: SyncResultPayload;
            error?: string;
          };
          if (!resp2.ok) throw new Error(data2.error || '校外子会话验证失败');
          if (data2.status === 'mfa_required') {
            setReAuthType(data2.defaultReAuthType || '4');
            setDynamicCode('');
            setStep('mfa');
            return;
          }
          if (data2.status === 'completed' && data2.result) {
            setCompletedResult(data2.result);
            setStep('done');
            onSyncCompleted(data2.result);
            return;
          }
        } else {
          pwdSnapshot = '';
          setCaptcha('');
          setCaptchaUri(data.needCaptcha ? data.captchaImageUri : undefined);
          setStep('wfw_subauth');
          return;
        }
      }

      if (data.status === 'completed' && data.result) {
        pwdSnapshot = '';
        setCompletedResult(data.result);
        setStep('done');
        onSyncCompleted(data.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败');
    } finally {
      pwdSnapshot = '';
      setBusy(false);
    }
  };

  const handleSendMfa = async () => {
    if (!sessionId || cooldown > 0) return;
    setError(null);
    setBusy(true);
    try {
      if (isNative && nativeSessionRef.current) {
        const msg = await nativeSessionRef.current.sendMfa(reAuthType);
        setMfaNotice(msg);
        setCooldown(60);
        return;
      }
      const resp = await fetch('/api/sync/mfa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, reAuthType }),
      });
      const data = (await resp.json()) as { message?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || '发送验证码失败');
      setMfaNotice(data.message || '验证码已发送，请查收');
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送验证码失败');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      if (isNative && nativeSessionRef.current) {
        const outcome = await nativeSessionRef.current.submitMfa(
          dynamicCode.trim(),
          reAuthType,
          xnm,
          xqm
        );
        if (outcome.status === 'wfw_subauth_required') {
          const cachedPwd = ephemeralPwdRef.current;
          ephemeralPwdRef.current = '';
          if (!outcome.subAuth.needCaptcha && cachedPwd) {
            const outcome2 = await nativeSessionRef.current.completeWfwSubAuth(cachedPwd, '', xnm, xqm);
            if (outcome2.status === 'mfa_required') {
              setReAuthType(outcome2.mfa.defaultReAuthType);
              setDynamicCode('');
              setCooldown(0);
              setMfaNotice('校外教务子通道需再验证一次动态码（最后一步，请点发送验证码）');
              setStep('mfa');
              return;
            }
            if (outcome2.status === 'completed') {
              setCompletedResult(outcome2.result);
              setStep('done');
              onSyncCompleted(outcome2.result);
              return;
            }
          }
          setSalt2(outcome.subAuth.salt2);
          setCaptcha('');
          setCaptchaUri(outcome.subAuth.needCaptcha ? outcome.subAuth.captchaImageUri : undefined);
          setStep('wfw_subauth');
          return;
        }
        if (outcome.status === 'mfa_required') {
          ephemeralPwdRef.current = '';
          setDynamicCode('');
          setCooldown(0);
          setMfaNotice('校外教务子通道需再验证一次动态码（最后一步，请点发送验证码）');
          return;
        }
        ephemeralPwdRef.current = '';
        setCompletedResult(outcome.result);
        setStep('done');
        onSyncCompleted(outcome.result);
        return;
      }

      const resp = await fetch('/api/sync/mfa/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, dynamicCode: dynamicCode.trim(), reAuthType, xnm, xqm }),
      });
      const data = (await resp.json()) as {
        status?: string;
        salt2?: string;
        needCaptcha?: boolean;
        captchaImageUri?: string;
        result?: SyncResultPayload;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || '验证码校验失败');

      if (data.status === 'wfw_subauth_required') {
        const subSalt = data.salt2 ?? '';
        setSalt2(subSalt);
        const cachedPwd = ephemeralPwdRef.current;
        ephemeralPwdRef.current = '';
        if (!data.needCaptcha && subSalt && cachedPwd) {
          const encryptedPassword2 = encryptGdouPasswordInBrowser(cachedPwd, subSalt);
          const resp2 = await fetch('/api/sync/wfw-subauth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              encryptedPassword: encryptedPassword2,
              captcha: '',
              xnm,
              xqm,
            }),
          });
          const data2 = (await resp2.json()) as {
            status?: string;
            defaultReAuthType?: '4' | '3';
            result?: SyncResultPayload;
            error?: string;
          };
          if (!resp2.ok) throw new Error(data2.error || '校外子会话验证失败');
          if (data2.status === 'mfa_required') {
            setReAuthType(data2.defaultReAuthType || '4');
            setDynamicCode('');
            setCooldown(0);
            setMfaNotice('校外教务子通道需再验证一次动态码（最后一步，请点发送验证码）');
            setStep('mfa');
            return;
          }
          if (data2.status === 'completed' && data2.result) {
            setCompletedResult(data2.result);
            setStep('done');
            onSyncCompleted(data2.result);
            return;
          }
        }
        setCaptcha('');
        setCaptchaUri(data.needCaptcha ? data.captchaImageUri : undefined);
        setStep('wfw_subauth');
        return;
      }
      if (data.status === 'mfa_required') {
        ephemeralPwdRef.current = '';
        setDynamicCode('');
        setCooldown(0);
        setMfaNotice('校外教务子通道需再验证一次动态码（最后一步，请点发送验证码）');
        return;
      }
      if (data.status === 'completed' && data.result) {
        ephemeralPwdRef.current = '';
        setCompletedResult(data.result);
        setStep('done');
        onSyncCompleted(data.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '多因子验证失败');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitWfwSubAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    let pwdSnapshot = password;
    setPassword('');

    try {
      if (isNative && nativeSessionRef.current) {
        const outcome = await nativeSessionRef.current.completeWfwSubAuth(
          pwdSnapshot,
          captcha.trim(),
          xnm,
          xqm
        );
        pwdSnapshot = '';
        if (outcome.status === 'mfa_required') {
          setReAuthType(outcome.mfa.defaultReAuthType);
          setDynamicCode('');
          setCooldown(0);
          setStep('mfa');
          return;
        }
        if (outcome.status === 'completed') {
          setCompletedResult(outcome.result);
          setStep('done');
          onSyncCompleted(outcome.result);
        }
        return;
      }

      const encryptedPassword = encryptGdouPasswordInBrowser(pwdSnapshot, salt2);
      pwdSnapshot = '';
      const resp = await fetch('/api/sync/wfw-subauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          encryptedPassword,
          captcha: captcha.trim(),
          xnm,
          xqm,
        }),
      });
      const data = (await resp.json()) as {
        status?: string;
        defaultReAuthType?: '4' | '3';
        result?: SyncResultPayload;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || '校外子会话验证失败');

      if (data.status === 'mfa_required') {
        setReAuthType(data.defaultReAuthType || '4');
        setDynamicCode('');
        setStep('mfa');
        return;
      }
      if (data.status === 'completed' && data.result) {
        setCompletedResult(data.result);
        setStep('done');
        onSyncCompleted(data.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '校外子会话验证失败');
    } finally {
      pwdSnapshot = '';
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="animate-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="animate-modal-pop max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              {isNative ? '手机本机直连海大教务' : '海大教务无痕同步'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isNative
                ? '纯手机直连官网 · 无任何中转服务器 · 永不封 IP · 用完即删'
                : '浏览器端 AES-128 本地加密 · 服务器全程零明文密码 · 同步完自动注销'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Network Route Badge */}
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-2.5 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            {networkRoute === 'wfw-webvpn' ? (
              <>
                <Globe className="h-4 w-4 shrink-0" />
                <span>
                  {isNative
                    ? '本机直连校外微门户 (wfw.gdou.edu.cn)，无需校园网'
                    : '已自动路由至 校外微门户 (wfw.gdou.edu.cn)，无需校园网'}
                </span>
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4 shrink-0" />
                <span>
                  已检测到校园网环境，直连 <strong>jw.gdou.edu.cn</strong>
                </span>
              </>
            )}
          </div>
          {step !== 'preparing' && step !== 'done' && (
            <button
              type="button"
              onClick={() => void initSession()}
              className="shrink-0 text-emerald-700 underline hover:text-emerald-900 dark:text-emerald-400"
            >
              重连
            </button>
          )}
        </div>

        {error && (
          <div className="mt-3 space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            {!isNative && error.includes('403') && (
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href="/downloads/gdou-schedule-android.apk"
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-500"
                >
                  <Download className="h-3 w-3" />
                  下载 Android 直连版 APK
                </a>
                <a
                  href="/downloads/gdou-schedule-ios-unsigned.ipa"
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-700"
                >
                  <Download className="h-3 w-3" />
                  下载 iOS 直连版 IPA
                </a>
              </div>
            )}
          </div>
        )}

        {/* Step 0: Preparing */}
        {step === 'preparing' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
            <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
              正在探测海大官方入口并获取 AES 加密盐值...
            </p>
          </div>
        )}

        {/* Step 1: Login */}
        {step === 'login' && (
          <form onSubmit={handleLoginSubmit} className="mt-4 space-y-3.5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                海大学号（统一身份认证账号）
              </label>
              <input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => void handleCheckCaptcha(false)}
                placeholder="例如：202411701234"
                autoComplete="off"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                统一身份认证密码
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="仅本次在内存 AES-128 加密提交，绝不保存"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>

            {captchaUri && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  图形验证码
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    required
                    value={captcha}
                    onChange={(e) => setCaptcha(e.target.value)}
                    placeholder="输入右侧验证码"
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                  />
                  <img
                    src={captchaUri}
                    alt="验证码"
                    onClick={() => void handleCheckCaptcha(true)}
                    title="点击刷新验证码"
                    className="h-10 cursor-pointer rounded-xl border border-slate-200 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCheckCaptcha(true)}
                    className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-500">同步学年</label>
                <select
                  value={xnm}
                  onChange={(e) => setXnm(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  {[2026, 2025, 2024, 2023].map((y) => (
                    <option key={y} value={String(y)}>
                      {y}-{y + 1} 学年
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-500">同步学期</label>
                <select
                  value={xqm}
                  onChange={(e) => setXqm(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="3">第 1 学期（秋）</option>
                  <option value="12">第 2 学期（春）</option>
                  <option value="16">第 3 学期（夏）</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || !sessionId}
              className="skin-bg-gradient mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white shadow-lg active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加密认证并拉取课表 / 考试 / 成绩...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  一键同步课表、考试与历年成绩
                </>
              )}
            </button>
          </form>
        )}

        {/* Step 2: MFA */}
        {step === 'mfa' && (
          <form onSubmit={handleSubmitMfa} className="mt-4 space-y-4">
            <div className="rounded-2xl bg-sky-50 p-3.5 text-xs text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
              <div className="flex items-center gap-1.5 font-bold">
                <Smartphone className="h-4 w-4" />
                海大统一身份认证触发多因子安全校验
              </div>
              <p className="mt-1 opacity-85">
                账号密码已验证通过。请选择验证方式获取动态码完成同步：
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['4', '企业微信验证码'],
                  ['3', '手机短信验证码'],
                ] as const
              ).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setReAuthType(code)}
                  className={`rounded-xl border py-2 text-xs font-semibold transition ${
                    reAuthType === code
                      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                required
                value={dynamicCode}
                onChange={(e) => setDynamicCode(e.target.value)}
                placeholder="输入 6 位动态验证码"
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="button"
                disabled={busy || cooldown > 0}
                onClick={() => void handleSendMfa()}
                className="shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700"
              >
                {cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
              </button>
            </div>

            {mfaNotice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{mfaNotice}</p>}

            <button
              type="submit"
              disabled={busy}
              className="skin-bg-primary flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              验证并拉取教务数据
            </button>
          </form>
        )}

        {/* Step 3: Off-campus WFW Sub-Auth */}
        {step === 'wfw_subauth' && (
          <form onSubmit={handleSubmitWfwSubAuth} className="mt-4 space-y-3.5">
            <div className="rounded-2xl bg-amber-50 p-3.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              校外微门户已激活！请输入密码完成教务子会话加密握手：
            </div>

            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="重新输入统一身份认证密码"
              autoComplete="new-password"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
            />

            {captchaUri && (
              <div className="flex items-center gap-2.5">
                <input
                  required
                  value={captcha}
                  onChange={(e) => setCaptcha(e.target.value)}
                  placeholder="输入右侧验证码"
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                />
                <img
                  src={captchaUri}
                  alt="验证码"
                  onClick={() => void handleCheckCaptcha(true)}
                  className="h-10 cursor-pointer rounded-xl border border-slate-200"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="skin-bg-primary flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              确认并完成教务同步
            </button>
          </form>
        )}

        {/* Step 4: Done & Audit Receipt */}
        {step === 'done' && completedResult && (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl bg-emerald-50 p-4 text-center dark:bg-emerald-950/40">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <h3 className="mt-2 text-base font-bold text-emerald-950 dark:text-emerald-200">
                同步成功 · {completedResult.termLabel}
              </h3>
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                共拉取 {completedResult.courses.length} 项课程、{completedResult.exams.length} 场考试、
                {completedResult.grades.length} 门历史成绩
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['内存凭据已清空', completedResult.receipt.credentialsPurged],
                ['官网会话已注销', completedResult.receipt.sessionLoggedOut],
                ['Cookie 罐已销毁', completedResult.receipt.cookiesFlushed],
                ['零凭据落盘校验', completedResult.receipt.storageCleaned],
              ].map(([label, ok]) => (
                <div
                  key={String(label)}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800"
                >
                  <span className="text-slate-600 dark:text-slate-300">{label}</span>
                  <span className={ok ? 'font-bold text-emerald-600' : 'font-bold text-amber-500'}>
                    {ok ? '已验证 ✓' : '已尝试'}
                  </span>
                </div>
              ))}
            </div>

            <div className="max-h-36 overflow-y-auto rounded-xl bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
              {completedResult.receipt.steps.map((s, i) => (
                <div key={i}>{s}</div>
              ))}
            </div>

            <button
              onClick={handleClose}
              className="skin-bg-primary w-full rounded-2xl py-3 text-sm font-bold text-white"
            >
              完成并查看我的课表
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
