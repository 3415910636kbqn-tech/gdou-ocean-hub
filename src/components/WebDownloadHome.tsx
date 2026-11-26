import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Lock,
  Moon,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Waves,
  Wifi,
} from 'lucide-react';
import {
  ALTSTORE_INSTALL_URL,
  APP_BUILD,
  APP_VERSION,
  AppUpdateCheckResult,
  checkAppUpdate,
  detectClientPlatform,
  FEATHER_ADD_SOURCE_URL,
  IOS_ALTSTORE_SOURCE_URL,
  isWeChatBrowser,
  SIDESTORE_ADD_SOURCE_URL,
  SIDESTORE_INSTALL_URL,
  TROLLSTORE_INSTALL_URL,
} from '../services/appDistribution';

interface WebDownloadHomeProps {
  hasCachedWebData: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onEnterWebPreview: () => void;
}

export const WebDownloadHome: React.FC<WebDownloadHomeProps> = ({
  hasCachedWebData,
  darkMode,
  onToggleDarkMode,
  onEnterWebPreview,
}) => {
  const detectedPlatform = detectClientPlatform();
  const inWeChat = isWeChatBrowser();

  const [activeGuide, setActiveGuide] = useState<'android' | 'ios'>(
    detectedPlatform === 'ios' ? 'ios' : 'android'
  );
  const [copiedSource, setCopiedSource] = useState(false);
  const [manifest, setManifest] = useState<AppUpdateCheckResult | null>(null);

  useEffect(() => {
    checkAppUpdate()
      .then((res) => setManifest(res))
      .catch(() => {
        /* ignore offline or fallback to built-in version constants */
      });
  }, []);

  const handleCopySource = async () => {
    try {
      await navigator.clipboard.writeText(IOS_ALTSTORE_SOURCE_URL);
      setCopiedSource(true);
      window.setTimeout(() => setCopiedSource(false), 2200);
    } catch {
      window.prompt('请长按全选复制 iOS 国内高速软件源地址：', IOS_ALTSTORE_SOURCE_URL);
    }
  };

  const versionLabel = manifest
    ? `v${manifest.latestVersion} (Build ${manifest.latestBuild})`
    : `v${APP_VERSION} (Build ${APP_BUILD})`;
  const apkSize = manifest?.androidSizeLabel || '3.36 MB';
  const ipaSize = manifest?.iosSizeLabel || '940 KB';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/85">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="skin-bg-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-md">
              <Waves className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">
                谁用你那难用的教务系统？
              </div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                广东海洋大学 · 手机直连客户端下载中心 ({versionLabel})
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleDarkMode}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 shadow-xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
            title="切换深浅色"
          >
            {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 pb-12">
        {/* Top Critical Announcement Banner */}
        <section className="relative overflow-hidden rounded-3xl border border-rose-200/90 bg-gradient-to-br from-rose-50 via-amber-50/70 to-white p-5 shadow-sm dark:border-rose-900/60 dark:from-rose-950/50 dark:via-slate-900 dark:to-slate-900 sm:p-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-[11px] font-bold text-white shadow-xs">
            <AlertTriangle className="h-3.5 w-3.5" />
            重要通知 · 网页端已迁移至直连 App
          </div>

          <h1 className="mt-3 text-xl font-extrabold leading-snug tracking-tight text-slate-950 dark:text-white sm:text-2xl">
            服务器 IP 被尼海封了，现在统一走手机直连 App！
          </h1>

          <p className="mt-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            因为用的人实在太多，网页版中转服务器的出口 IP 已经被广东海洋大学微门户（<code className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-xs text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">wfw.gdou.edu.cn</code>）封禁（403），网页端无法再替大家中转同步教务了。
            <br />
            <strong className="text-slate-950 dark:text-white">
              换用下面的手机直连 App 反而更好用：数据完全不走任何第三方服务器，更安全；直接用你自己的手机网络连海大官网，登录更稳定、再也不会被封 IP！
            </strong>
          </p>

          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100/90 px-3 py-1.5 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              完全不走服务器 · 数据更安全
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-sky-100/90 px-3 py-1.5 text-sky-900 dark:bg-sky-950/70 dark:text-sky-200">
              <Wifi className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              手机本机直连 · 登录更稳定不封 IP
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-100/90 px-3 py-1.5 text-indigo-900 dark:bg-indigo-950/70 dark:text-indigo-200">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              国内服务器满速直下 · 免梯子
            </span>
          </div>
        </section>

        {/* WeChat Built-in Browser Reminder */}
        {inWeChat && (
          <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950 shadow-xs dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="text-sm font-extrabold">检测到你在微信里打开了本页面</div>
              <p className="mt-1">
                微信内置浏览器会拦截安装包下载。请点击屏幕右上角 <strong>···</strong> → 选择{' '}
                <strong>「在浏览器打开」</strong>（安卓选系统浏览器，iPhone 选 Safari），即可满速下载安装！
              </p>
            </div>
          </div>
        )}

        {/* Quick Download Cards (Both Android & iOS Immediately Accessible) */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* Android Card */}
          <div
            className={`relative flex flex-col justify-between rounded-3xl border bg-white p-5 shadow-xs transition dark:bg-slate-900 ${
              detectedPlatform === 'android'
                ? 'border-emerald-400 ring-2 ring-emerald-500/20 dark:border-emerald-600'
                : 'border-slate-200/90 dark:border-slate-800'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <Smartphone className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                      Android 安卓版
                    </h2>
                    <div className="text-[11px] text-slate-500">
                      正式签名 Release APK · {apkSize}
                    </div>
                  </div>
                </div>
                {detectedPlatform === 'android' && (
                  <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10.5px] font-bold text-white">
                    当前设备推荐
                  </span>
                )}
              </div>

              <ul className="mt-3.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  下载后直接安装，无需电脑、无需折腾
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  固定独立正式签名，以后新版直接覆盖更新不丢课表
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  支持校园网直连与校外微门户 MFA 双通道同步
                </li>
              </ul>
            </div>

            <div className="mt-5 space-y-2">
              <a
                href="/downloads/gdou-schedule-android.apk"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-emerald-600/20 transition hover:bg-emerald-500 active:scale-[0.98]"
              >
                <Download className="h-4 w-4" />
                立即下载 Android APK ({apkSize})
              </a>
              <button
                type="button"
                onClick={() => {
                  setActiveGuide('android');
                  document.getElementById('install-guide')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="w-full py-1 text-center text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                查看安卓 3 步安装与导入教程 ↓
              </button>
            </div>
          </div>

          {/* iOS Card */}
          <div
            className={`relative flex flex-col justify-between rounded-3xl border bg-white p-5 shadow-xs transition dark:bg-slate-900 ${
              detectedPlatform === 'ios'
                ? 'border-sky-400 ring-2 ring-sky-500/20 dark:border-sky-600'
                : 'border-slate-200/90 dark:border-slate-800'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-800">
                    <Smartphone className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                      iPhone / iPad (iOS)
                    </h2>
                    <div className="text-[11px] text-slate-500">
                      iOS 18+ 预签槽位 IPA · {ipaSize}
                    </div>
                  </div>
                </div>
                {detectedPlatform === 'ios' && (
                  <span className="rounded-full bg-sky-600 px-2.5 py-0.5 text-[10.5px] font-bold text-white">
                    当前设备推荐
                  </span>
                )}
              </div>

              <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                因未上架 App Store，需通过 <strong>爱思助手 / Sideloadly / SideStore / AltStore / 轻松签 / 巨魔</strong> 侧载安装（已提供国内高速软件源，无需梯子）：
              </p>

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <a
                  href={TROLLSTORE_INSTALL_URL}
                  className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <ExternalLink className="h-3 w-3 text-sky-600" />
                  巨魔一键直装
                </a>
                <a
                  href={SIDESTORE_INSTALL_URL}
                  className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <ExternalLink className="h-3 w-3 text-sky-600" />
                  SideStore 直装
                </a>
                <a
                  href={ALTSTORE_INSTALL_URL}
                  className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <ExternalLink className="h-3 w-3 text-sky-600" />
                  AltStore 直装
                </a>
                <a
                  href={FEATHER_ADD_SOURCE_URL}
                  className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <ExternalLink className="h-3 w-3 text-sky-600" />
                  添加 Feather 源
                </a>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <a
                href="/downloads/gdou-schedule-ios-unsigned.ipa"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white shadow-md transition hover:bg-slate-800 active:scale-[0.98] dark:bg-sky-600 dark:hover:bg-sky-500"
              >
                <Download className="h-4 w-4" />
                下载 iOS IPA 安装包 ({ipaSize})
              </a>

              <div className="flex items-center gap-2">
                <a
                  href={SIDESTORE_ADD_SOURCE_URL}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  添加 SideStore 源
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopySource()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {copiedSource ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedSource ? '已复制国内源' : '复制国内软件源'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Step-by-Step Installation & Usage Tutorials */}
        <section
          id="install-guide"
          className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                手把手安装与同步教程
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                1 分钟装完，一次同步后整个学期离线秒看课表、考试和绩点
              </p>
            </div>

            <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setActiveGuide('android')}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                  activeGuide === 'android'
                    ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-700 dark:text-emerald-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                Android 安卓教程
              </button>
              <button
                type="button"
                onClick={() => setActiveGuide('ios')}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                  activeGuide === 'ios'
                    ? 'bg-white text-sky-700 shadow-xs dark:bg-slate-700 dark:text-sky-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                iPhone / iOS 教程
              </button>
            </div>
          </div>

          {activeGuide === 'android' ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-extrabold text-white">
                  1
                </div>
                <h3 className="mt-2.5 text-sm font-bold text-slate-900 dark:text-white">
                  浏览器下载 APK
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  如果在微信/QQ 里点开的，先点右上角 <strong>···</strong> →{' '}
                  <strong>在浏览器打开</strong>，再点上方绿色按钮下载安装包（仅 {apkSize}，秒下）。
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-extrabold text-white">
                  2
                </div>
                <h3 className="mt-2.5 text-sm font-bold text-slate-900 dark:text-white">
                  允许安装未知应用
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  点击下载好的 <code className="font-mono">.apk</code> 文件安装。因为是个人开源项目没上架手机商店，若系统提示安全提醒，选{' '}
                  <strong>允许 / 仍要安装</strong>（小米/华为可在安装页勾选「了解风险」或临时关纯净模式）。
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-extrabold text-white">
                  3
                </div>
                <h3 className="mt-2.5 text-sm font-bold text-slate-900 dark:text-white">
                  点右上角直连导入
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  打开桌面上的 <strong>「谁用你那难用的教务系统？」</strong>，点右上角{' '}
                  <strong>「教务同步」</strong> 输入学号密码（校外按提示收短信/企业微信验证码），10 秒拉全课表、考试与绩点！
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-sky-200/70 bg-sky-50/60 p-4 dark:border-sky-900/50 dark:bg-sky-950/30">
                <h3 className="text-sm font-bold text-sky-950 dark:text-sky-200">
                  方案 A：电脑免费自签安装（零基础最通用 · 2 分钟搞定）
                </h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <li>
                    先在电脑或手机下载上面的 <strong>iOS IPA 安装包</strong>（{ipaSize}）。
                  </li>
                  <li>
                    电脑打开 <strong>爱思助手</strong>（顶部「工具箱」→「IPA 签名」→「使用 Apple ID 签名」）或{' '}
                    <strong>Sideloadly</strong>，数据线连上 iPhone，拖入下载好的 <code className="font-mono">.ipa</code> 并登录自己的 Apple ID 一键签名安装。
                  </li>
                  <li>
                    装好后首次打不开是正常的：进 iPhone <strong>设置 → 通用 → VPN 与设备管理</strong> → 点你的 Apple ID → 点 <strong>信任</strong>，即可正常使用！（iOS 16+ 若提示开启开发者模式，在「设置 → 隐私与安全性 → 开发者模式」打开重启即可）
                  </li>
                </ol>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    方案 B：SideStore / AltStore / 轻松签 / Feather
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    已经装了侧载工具的同学，直接在 iPhone Safari 点上方 <strong>「SideStore / AltStore 直装」</strong>，或点 <strong>「复制国内软件源」</strong> 粘贴到轻松签 / Feather 软件源中，免电脑、国内满速下载安装与更新！
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    方案 C：巨魔（TrollStore）用户
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    设备已装巨魔的同学，在 Safari 点上方 <strong>「巨魔一键直装」</strong>，或下载 <code className="font-mono">.ipa</code> 分享到 TrollStore，永久免签、无需 7 天续签！
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Why App Is Better: Security & Stability Highlights */}
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <Lock className="h-5 w-5 text-emerald-600" />
            <h3 className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
              完全不走服务器，更安全
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              账号和密码只在你手机本地加密并直发海大官方教务，无任何中转服务器、无云端数据库、纯内存 Cookie 用完即删。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <Wifi className="h-5 w-5 text-sky-600" />
            <h3 className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
              本机 IP 直连，登录更稳定
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              每个人都走自己手机的独立网络，彻底告别万人挤同一台服务器导致的 403 封禁，校内校园网和校外流量都能丝滑直连。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            <h3 className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
              全套功能离线秒开
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              60fps 丝滑翻周课表、情侣双人课表口令互传、高清课表壁纸海报、考试座位倒计时、5.0 绩点计算器与 4 套主题皮肤。
            </p>
          </div>
        </section>

        {/* Footer Acknowledgement + Optional Web Preview Entry */}
        <footer className="space-y-4 pt-2 text-center">
          <div className="flex flex-col items-center justify-center gap-2">
            {hasCachedWebData ? (
              <button
                type="button"
                onClick={onEnterWebPreview}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                查看我之前在网页版缓存的本地课表（离线只读）
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onEnterWebPreview}
                className="inline-flex items-center gap-1 text-xs text-slate-400 underline underline-offset-4 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                仅预览网页版界面（网页端已无法同步，请下载上方 App）
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            感谢网名“圆头耄耋514”同学提供的SSO协议，为本项目做出了重大贡献。
          </p>
        </footer>
      </main>
    </div>
  );
};
