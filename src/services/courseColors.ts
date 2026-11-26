import type { ThemeSkinKey } from '../../shared/models';

export interface CoursePaletteStyle {
  bg: string;
  border: string;
  title: string;
  sub: string;
  accent: string;
  // Hex colors for Canvas HD poster rendering
  hexBg: string;
  hexBorder: string;
  hexTitle: string;
  hexSub: string;
}

export interface ThemeSkinMeta {
  key: ThemeSkinKey;
  label: string;
  description: string;
  bannerGradient: string;
  previewSwatches: [string, string, string];
  palettes: CoursePaletteStyle[];
}

const OCEAN_PALETTES: CoursePaletteStyle[] = [
  {
    bg: 'bg-sky-50/92 dark:bg-sky-950/65',
    border: 'border-sky-200/90 dark:border-sky-800/70',
    title: 'text-sky-950 dark:text-sky-100',
    sub: 'text-sky-700/90 dark:text-sky-300/85',
    accent: 'bg-sky-500',
    hexBg: '#f0f9ff',
    hexBorder: '#bae6fd',
    hexTitle: '#082f49',
    hexSub: '#0369a1',
  },
  {
    bg: 'bg-indigo-50/92 dark:bg-indigo-950/65',
    border: 'border-indigo-200/90 dark:border-indigo-800/70',
    title: 'text-indigo-950 dark:text-indigo-100',
    sub: 'text-indigo-700/90 dark:text-indigo-300/85',
    accent: 'bg-indigo-500',
    hexBg: '#eef2ff',
    hexBorder: '#c7d2fe',
    hexTitle: '#1e1b4b',
    hexSub: '#4338ca',
  },
  {
    bg: 'bg-teal-50/92 dark:bg-teal-950/65',
    border: 'border-teal-200/90 dark:border-teal-800/70',
    title: 'text-teal-950 dark:text-teal-100',
    sub: 'text-teal-700/90 dark:text-teal-300/85',
    accent: 'bg-teal-500',
    hexBg: '#f0fdfa',
    hexBorder: '#99f6e4',
    hexTitle: '#042f2e',
    hexSub: '#0f766e',
  },
  {
    bg: 'bg-amber-50/92 dark:bg-amber-950/60',
    border: 'border-amber-200/90 dark:border-amber-800/70',
    title: 'text-amber-950 dark:text-amber-100',
    sub: 'text-amber-700/90 dark:text-amber-300/85',
    accent: 'bg-amber-500',
    hexBg: '#fffbeb',
    hexBorder: '#fde68a',
    hexTitle: '#451a03',
    hexSub: '#b45309',
  },
  {
    bg: 'bg-rose-50/92 dark:bg-rose-950/60',
    border: 'border-rose-200/90 dark:border-rose-800/70',
    title: 'text-rose-950 dark:text-rose-100',
    sub: 'text-rose-700/90 dark:text-rose-300/85',
    accent: 'bg-rose-500',
    hexBg: '#fff1f2',
    hexBorder: '#fecdd3',
    hexTitle: '#4c0519',
    hexSub: '#be123c',
  },
  {
    bg: 'bg-violet-50/92 dark:bg-violet-950/65',
    border: 'border-violet-200/90 dark:border-violet-800/70',
    title: 'text-violet-950 dark:text-violet-100',
    sub: 'text-violet-700/90 dark:text-violet-300/85',
    accent: 'bg-violet-500',
    hexBg: '#f5f3ff',
    hexBorder: '#ddd6fe',
    hexTitle: '#2e1065',
    hexSub: '#6d28d9',
  },
  {
    bg: 'bg-emerald-50/92 dark:bg-emerald-950/60',
    border: 'border-emerald-200/90 dark:border-emerald-800/70',
    title: 'text-emerald-950 dark:text-emerald-100',
    sub: 'text-emerald-700/90 dark:text-emerald-300/85',
    accent: 'bg-emerald-500',
    hexBg: '#ecfdf5',
    hexBorder: '#a7f3d0',
    hexTitle: '#022c22',
    hexSub: '#047857',
  },
  {
    bg: 'bg-cyan-50/92 dark:bg-cyan-950/65',
    border: 'border-cyan-200/90 dark:border-cyan-800/70',
    title: 'text-cyan-950 dark:text-cyan-100',
    sub: 'text-cyan-700/90 dark:text-cyan-300/85',
    accent: 'bg-cyan-500',
    hexBg: '#ecfeff',
    hexBorder: '#a5f3fc',
    hexTitle: '#083344',
    hexSub: '#0e7490',
  },
];

const MORANDI_PALETTES: CoursePaletteStyle[] = [
  {
    bg: 'bg-[#eef2f0]/95 dark:bg-[#22302c]/80',
    border: 'border-[#cbd7d1] dark:border-[#3c524b]',
    title: 'text-[#283c36] dark:text-[#dce8e3]',
    sub: 'text-[#526d64] dark:text-[#9eb7ae]',
    accent: 'bg-[#6f8f83]',
    hexBg: '#eef2f0',
    hexBorder: '#cbd7d1',
    hexTitle: '#283c36',
    hexSub: '#526d64',
  },
  {
    bg: 'bg-[#f4eee9]/95 dark:bg-[#352b24]/80',
    border: 'border-[#dfcfc2] dark:border-[#5b493c]',
    title: 'text-[#493629] dark:text-[#efe3d8]',
    sub: 'text-[#7c6150] dark:text-[#c7ae9b]',
    accent: 'bg-[#a6836c]',
    hexBg: '#f4eee9',
    hexBorder: '#dfcfc2',
    hexTitle: '#493629',
    hexSub: '#7c6150',
  },
  {
    bg: 'bg-[#edf0f5]/95 dark:bg-[#232b38]/80',
    border: 'border-[#ccd4e2] dark:border-[#3f4d66]',
    title: 'text-[#273347] dark:text-[#dce3f0]',
    sub: 'text-[#536480] dark:text-[#9eaec9]',
    accent: 'bg-[#7387a6]',
    hexBg: '#edf0f5',
    hexBorder: '#ccd4e2',
    hexTitle: '#273347',
    hexSub: '#536480',
  },
  {
    bg: 'bg-[#f5eff1]/95 dark:bg-[#36262c]/80',
    border: 'border-[#e0cdd3] dark:border-[#5e424c]',
    title: 'text-[#4c2e38] dark:text-[#f0dfe5]',
    sub: 'text-[#805865] dark:text-[#c7a1ad]',
    accent: 'bg-[#a87988]',
    hexBg: '#f5eff1',
    hexBorder: '#e0cdd3',
    hexTitle: '#4c2e38',
    hexSub: '#805865',
  },
  {
    bg: 'bg-[#f3f2ea]/95 dark:bg-[#323022]/80',
    border: 'border-[#dcd9c4] dark:border-[#57523a]',
    title: 'text-[#423f28] dark:text-[#ecead6]',
    sub: 'text-[#746f4c] dark:text-[#bfb993]',
    accent: 'bg-[#9d966c]',
    hexBg: '#f3f2ea',
    hexBorder: '#dcd9c4',
    hexTitle: '#423f28',
    hexSub: '#746f4c',
  },
  {
    bg: 'bg-[#f0eef5]/95 dark:bg-[#2c2738]/80',
    border: 'border-[#d6cfe3] dark:border-[#4e4566]',
    title: 'text-[#372d4a] dark:text-[#e5dff2]',
    sub: 'text-[#665882] dark:text-[#b2a4cc]',
    accent: 'bg-[#8879a6]',
    hexBg: '#f0eef5',
    hexBorder: '#d6cfe3',
    hexTitle: '#372d4a',
    hexSub: '#665882',
  },
];

const SAKURA_PALETTES: CoursePaletteStyle[] = [
  {
    bg: 'bg-pink-50/92 dark:bg-pink-950/60',
    border: 'border-pink-200/90 dark:border-pink-800/70',
    title: 'text-pink-950 dark:text-pink-100',
    sub: 'text-pink-700/90 dark:text-pink-300/85',
    accent: 'bg-pink-500',
    hexBg: '#fdf2f8',
    hexBorder: '#fbcfe8',
    hexTitle: '#500724',
    hexSub: '#be185d',
  },
  {
    bg: 'bg-rose-50/92 dark:bg-rose-950/60',
    border: 'border-rose-200/90 dark:border-rose-800/70',
    title: 'text-rose-950 dark:text-rose-100',
    sub: 'text-rose-700/90 dark:text-rose-300/85',
    accent: 'bg-rose-500',
    hexBg: '#fff1f2',
    hexBorder: '#fecdd3',
    hexTitle: '#4c0519',
    hexSub: '#be123c',
  },
  {
    bg: 'bg-fuchsia-50/92 dark:bg-fuchsia-950/60',
    border: 'border-fuchsia-200/90 dark:border-fuchsia-800/70',
    title: 'text-fuchsia-950 dark:text-fuchsia-100',
    sub: 'text-fuchsia-700/90 dark:text-fuchsia-300/85',
    accent: 'bg-fuchsia-500',
    hexBg: '#fdf4ff',
    hexBorder: '#f5d0fe',
    hexTitle: '#4a044e',
    hexSub: '#a21caf',
  },
  {
    bg: 'bg-purple-50/92 dark:bg-purple-950/60',
    border: 'border-purple-200/90 dark:border-purple-800/70',
    title: 'text-purple-950 dark:text-purple-100',
    sub: 'text-purple-700/90 dark:text-purple-300/85',
    accent: 'bg-purple-500',
    hexBg: '#faf5ff',
    hexBorder: '#e9d5ff',
    hexTitle: '#3b0764',
    hexSub: '#7e22ce',
  },
  {
    bg: 'bg-orange-50/92 dark:bg-orange-950/55',
    border: 'border-orange-200/90 dark:border-orange-800/70',
    title: 'text-orange-950 dark:text-orange-100',
    sub: 'text-orange-700/90 dark:text-orange-300/85',
    accent: 'bg-orange-400',
    hexBg: '#fff7ed',
    hexBorder: '#fed7aa',
    hexTitle: '#431407',
    hexSub: '#c2410c',
  },
];

const MONO_PALETTES: CoursePaletteStyle[] = [
  {
    bg: 'bg-slate-100/95 dark:bg-slate-800/85',
    border: 'border-slate-300 dark:border-slate-700',
    title: 'text-slate-900 dark:text-slate-50',
    sub: 'text-slate-600 dark:text-slate-300',
    accent: 'bg-slate-800 dark:bg-slate-200',
    hexBg: '#f1f5f9',
    hexBorder: '#cbd5e1',
    hexTitle: '#0f172a',
    hexSub: '#475569',
  },
  {
    bg: 'bg-zinc-100/95 dark:bg-zinc-800/85',
    border: 'border-zinc-300 dark:border-zinc-700',
    title: 'text-zinc-900 dark:text-zinc-50',
    sub: 'text-zinc-600 dark:text-zinc-300',
    accent: 'bg-zinc-700 dark:bg-zinc-300',
    hexBg: '#f4f4f5',
    hexBorder: '#d4d4d8',
    hexTitle: '#18181b',
    hexSub: '#52525b',
  },
  {
    bg: 'bg-stone-100/95 dark:bg-stone-800/85',
    border: 'border-stone-300 dark:border-stone-700',
    title: 'text-stone-900 dark:text-stone-50',
    sub: 'text-stone-600 dark:text-stone-300',
    accent: 'bg-stone-700 dark:bg-stone-300',
    hexBg: '#f5f5f4',
    hexBorder: '#d6d3d1',
    hexTitle: '#1c1917',
    hexSub: '#57534e',
  },
];

export const THEME_SKINS: Record<ThemeSkinKey, ThemeSkinMeta> = {
  ocean: {
    key: 'ocean',
    label: '海大蔚蓝',
    description: '清爽海洋与渐变蓝调，经典百搭',
    bannerGradient: 'from-sky-600 via-blue-600 to-indigo-600',
    previewSwatches: ['#0ea5e9', '#6366f1', '#14b8a6'],
    palettes: OCEAN_PALETTES,
  },
  morandi: {
    key: 'morandi',
    label: '莫兰迪柔雾',
    description: '低饱和度高级灰调，久看不累眼',
    bannerGradient: 'from-[#5f7d72] via-[#5e728a] to-[#796b85]',
    previewSwatches: ['#6f8f83', '#a6836c', '#7387a6'],
    palettes: MORANDI_PALETTES,
  },
  sakura: {
    key: 'sakura',
    label: '樱花粉黛',
    description: '元气浅粉与霞光橘紫，清新浪漫',
    bannerGradient: 'from-pink-500 via-rose-500 to-fuchsia-600',
    previewSwatches: ['#ec4899', '#f43f5e', '#a855f7'],
    palettes: SAKURA_PALETTES,
  },
  mono: {
    key: 'mono',
    label: '极简黑白',
    description: '克制沉稳的瑞士杂志极简风',
    bannerGradient: 'from-slate-800 via-slate-900 to-zinc-900',
    previewSwatches: ['#1e293b', '#64748b', '#cbd5e1'],
    palettes: MONO_PALETTES,
  },
};

export function getCoursePalette(colorIndex: number, skin: ThemeSkinKey = 'ocean'): CoursePaletteStyle {
  const list = THEME_SKINS[skin]?.palettes ?? OCEAN_PALETTES;
  return list[Math.abs(colorIndex) % list.length];
}
