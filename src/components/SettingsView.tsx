import React, { useRef } from 'react';
import {
  Calendar,
  Clock,
  Database,
  Download,
  Image as ImageIcon,
  Palette,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import { CAMPUS_PRESETS, getActivePeriods } from '../../shared/gdouTimetable';
import type {
  AppSettings,
  CampusPresetKey,
  PersistedAppData,
  ThemeSkinKey,
} from '../../shared/models';
import { THEME_SKINS } from '../services/courseColors';
import { isNativeMobileApp } from '../services/nativeHttpBridge';
import { triggerTextDownload } from '../services/storage';

interface SettingsViewProps {
  data: PersistedAppData;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onLoadSample: () => void;
  onImportJson: (json: PersistedAppData) => void;
  onClearAll: () => void;
}

function compressImageToDataUrl(file: File, maxDim = 960): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式无效'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  data,
  onUpdateSettings,
  onLoadSample,
  onImportJson,
  onClearAll,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const periods = getActivePeriods(data.settings);

  const handleExportJson = () => {
    triggerTextDownload(
      `gdou-ocean-hub-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as PersistedAppData;
        if (Array.isArray(parsed.courses) && Array.isArray(parsed.grades)) {
          onImportJson(parsed);
        }
      } catch {
        alert('备份文件格式无效，请选择本应用导出的 JSON 文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToDataUrl(file);
      onUpdateSettings({ scheduleBgImage: compressed });
    } catch {
      alert('图片读取失败，请换一张 JPG/PNG 图片试试');
    }
    e.target.value = '';
  };

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        {/* Theme Skin & Custom Background */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Palette className="h-4 w-4 text-sky-500" />
            个性化主题皮肤与课表背景
          </h3>

          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {(Object.keys(THEME_SKINS) as ThemeSkinKey[]).map((key) => {
              const skin = THEME_SKINS[key];
              const active = data.settings.themeSkin === key;
              return (
                <button
                  key={key}
                  onClick={() => onUpdateSettings({ themeSkin: key })}
                  className={`rounded-xl border p-3 text-left transition-all duration-200 active:scale-[0.97] ${
                    active
                      ? 'skin-soft-pill shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {skin.label}
                    </span>
                    <div className="flex gap-1">
                      {skin.previewSwatches.map((hex) => (
                        <span
                          key={hex}
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{skin.description}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <ImageIcon className="h-4 w-4 text-sky-500" />
                自定义课表背景图片
              </div>
              <div className="flex items-center gap-2">
                {data.settings.scheduleBgImage && (
                  <button
                    onClick={() => onUpdateSettings({ scheduleBgImage: '' })}
                    className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300"
                  >
                    清除背景
                  </button>
                )}
                <button
                  onClick={() => bgInputRef.current?.click()}
                  className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500"
                >
                  {data.settings.scheduleBgImage ? '更换图片' : '选择本地图片'}
                </button>
                <input
                  ref={bgInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBgUpload}
                  className="hidden"
                />
              </div>
            </div>

            {data.settings.scheduleBgImage && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>背景图透明度</span>
                  <span>{Math.round((data.settings.scheduleBgOpacity ?? 0.28) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.65}
                  step={0.05}
                  value={data.settings.scheduleBgOpacity ?? 0.28}
                  onChange={(e) => onUpdateSettings({ scheduleBgOpacity: Number(e.target.value) })}
                  className="w-full accent-sky-600"
                />
              </div>
            )}
          </div>
        </div>

        {/* Campus & Term Settings */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Calendar className="h-4 w-4 text-sky-500" />
            校历与开学首周设置
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">第 1 周周一日期</label>
              <input
                type="date"
                value={data.settings.termStartDate}
                onChange={(e) => onUpdateSettings({ termStartDate: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">本学期总周数</label>
              <input
                type="number"
                min={10}
                max={25}
                value={data.settings.totalWeeks}
                onChange={(e) =>
                  onUpdateSettings({
                    totalWeeks: Math.max(10, Math.min(25, Number(e.target.value) || 20)),
                  })
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Clock className="h-4 w-4 text-sky-500" />
            海大校区作息时间表
          </h3>
          <div className="mt-3 space-y-2">
            {(Object.keys(CAMPUS_PRESETS) as Exclude<CampusPresetKey, 'custom'>[]).map((key) => {
              const preset = CAMPUS_PRESETS[key];
              const active = data.settings.campusPreset === key;
              return (
                <button
                  key={key}
                  onClick={() => onUpdateSettings({ campusPreset: key })}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-sky-500 bg-sky-50/70 dark:border-sky-600 dark:bg-sky-950/40'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {preset.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{preset.description}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {periods.slice(0, 12).map((p) => (
              <div
                key={p.section}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800/70"
              >
                <span className="font-bold text-slate-700 dark:text-slate-200">第{p.section}节</span>
                <span className="font-mono text-[11px] text-slate-500">
                  {p.start}-{p.end}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Column: Native App Download, PWA, Audit & Backup */}
      <div className="space-y-5 lg:col-span-5">
        {!isNativeMobileApp() && (
          <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-teal-50/60 p-5 dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-teal-950/30">
            <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-950 dark:text-emerald-200">
              <Download className="h-4 w-4 text-emerald-600" />
              下载手机直连客户端（永不封 IP · 零中转）
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-emerald-900/80 dark:text-emerald-200/80">
              安装客户端后，请求直接从你自己的手机直连海大教务官网，完全不经过中转服务器，彻底告别 403 限流！
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href="/downloads/gdou-schedule-android.apk"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-500"
              >
                <Download className="h-3.5 w-3.5" />
                Android APK
              </a>
              <a
                href="/downloads/gdou-schedule-ios-unsigned.ipa"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-slate-800 dark:bg-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                iOS IPA
              </a>
            </div>
            <p className="mt-2 text-[10.5px] text-emerald-800/70 dark:text-emerald-300/70">
              iOS 未签名 IPA 支持 AltStore / SideStore / Sideloadly / 轻松签 / TrollStore 自签安装
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50 to-indigo-50/60 p-5 dark:border-sky-900/50 dark:from-sky-950/40 dark:to-indigo-950/30">
          <h3 className="flex items-center gap-2 text-sm font-bold text-sky-950 dark:text-sky-200">
            <Smartphone className="h-4 w-4 text-sky-600" />
            添加到手机桌面（离线秒开 App）
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-sky-900/80 dark:text-sky-200/80">
            本应用已支持 <strong>PWA 离线缓存</strong>。在手机浏览器点击菜单 → <strong>「添加到主屏幕」</strong>（iOS Safari 点底部分享图标），即可在桌面生成海大专属图标，全屏打开且在教学楼没网时也能秒看课表和考场座位号！
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-200/80 bg-white p-5 shadow-xs dark:border-emerald-900/50 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            隐私与零留存安全审计
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            密码在你的浏览器本地使用 WebCrypto + AES-128 加密后再提交，服务器全程零明文密码、零数据库存储，同步结束自动调用海大官方注销接口并销毁内存 Cookie。
          </p>

          {data.lastSyncReceipt ? (
            <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
              <div className="flex justify-between">
                <span className="text-slate-500">最近同步时间</span>
                <span className="font-medium">
                  {new Date(data.lastSyncReceipt.syncedAtIso).toLocaleString('zh-CN')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">网络通道</span>
                <span className="font-medium">
                  {data.lastSyncReceipt.networkRoute === 'wfw-webvpn'
                    ? '校外微门户 (wfw)'
                    : '校园网直连 (jw)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">凭据清空 / 官网注销</span>
                <span className="font-bold text-emerald-600">
                  {data.lastSyncReceipt.credentialsPurged && data.lastSyncReceipt.sessionLoggedOut
                    ? '全部通过 ✓'
                    : '已清理'}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/70">
              点击右上角「教务同步」即可拉取你本人的真实课表、考试、成绩与今日空教室。
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Database className="h-4 w-4 text-sky-500" />
            本地数据管理
          </h3>
          <div className="mt-4 space-y-2.5">
            <button
              onClick={handleExportJson}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              导出课表/成绩 JSON 备份（不含凭据）
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Upload className="h-4 w-4" />
              从 JSON 备份恢复数据
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={onLoadSample}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-50 py-2.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300"
            >
              <RefreshCcw className="h-4 w-4" />
              重新加载海大示例数据
            </button>
            <button
              onClick={onClearAll}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-50 py-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-400"
            >
              <Trash2 className="h-4 w-4" />
              清空全部本地缓存数据
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
