import { DAY_LABELS } from '../../shared/gdouTimetable';
import type { CourseItem, PeriodTime, ThemeSkinKey } from '../../shared/models';
import { getDateForWeekAndDay } from '../../shared/parsers';
import { getCoursePalette, THEME_SKINS } from './courseColors';

export interface PosterOptions {
  mode: 'poster' | 'wallpaper';
  courses: CourseItem[];
  periods: PeriodTime[];
  week: number;
  termStartDate: string;
  termLabel: string;
  skin: ThemeSkinKey;
  darkMode: boolean;
  bgImageDataUrl?: string;
  bgOpacity?: number;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const chars = Array.from(text || '');
  const lines: string[] = [];
  let cur = '';
  for (const ch of chars) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur.length > 0) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur += ch;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderSchedulePosterPng(opts: PosterOptions): Promise<string> {
  const isWallpaper = opts.mode === 'wallpaper';
  const W = isWallpaper ? 1170 : 1080;
  const H = isWallpaper ? 2532 : 1920;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Base background
  ctx.fillStyle = opts.darkMode ? '#0b1120' : '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  // Subtle ambient gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  const swatches = THEME_SKINS[opts.skin]?.previewSwatches ?? ['#0ea5e9', '#6366f1', '#14b8a6'];
  grad.addColorStop(0, opts.darkMode ? '#0f172a' : '#f0f9ff');
  grad.addColorStop(1, opts.darkMode ? '#1e1b4b' : '#eef2ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Custom user background photo (cover crop)
  if (opts.bgImageDataUrl) {
    const img = await loadImage(opts.bgImageDataUrl);
    if (img) {
      ctx.save();
      ctx.globalAlpha = opts.bgOpacity ?? 0.3;
      const scale = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
    }
  }

  // Wallpaper top safe zone for iOS/Android lockscreen clock (~540px)
  const topOffset = isWallpaper ? 560 : 84;
  const padX = 36;
  const headerH = 110;

  // Header card
  ctx.save();
  drawRoundedRect(ctx, padX, topOffset, W - padX * 2, headerH, 28);
  const hGrad = ctx.createLinearGradient(padX, topOffset, W - padX, topOffset + headerH);
  hGrad.addColorStop(0, swatches[0]);
  hGrad.addColorStop(1, swatches[1]);
  ctx.fillStyle = hGrad;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`海大课表 · 第 ${opts.week} 周`, padX + 34, topOffset + 56);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(opts.termLabel || '广东海洋大学', padX + 34, topOffset + 92);
  ctx.restore();

  // Schedule container card
  const gridTop = topOffset + headerH + 24;
  const bottomPad = isWallpaper ? 120 : 68;
  const gridH = H - gridTop - bottomPad;
  const gridW = W - padX * 2;

  ctx.save();
  drawRoundedRect(ctx, padX, gridTop, gridW, gridH, 28);
  ctx.fillStyle = opts.darkMode ? 'rgba(15, 23, 42, 0.86)' : 'rgba(255, 255, 255, 0.90)';
  ctx.fill();
  ctx.strokeStyle = opts.darkMode ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const dayHeaderH = 74;
  const timeColW = 86;
  const colW = (gridW - timeColW) / 7;
  const periods = opts.periods.slice(0, 12);
  const rowH = (gridH - dayHeaderH) / periods.length;

  // Day headers
  for (let d = 0; d < 7; d++) {
    const cx = padX + timeColW + d * colW + colW / 2;
    const dt = getDateForWeekAndDay(opts.termStartDate, opts.week, d + 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = opts.darkMode ? '#e2e8f0' : '#0f172a';
    ctx.font = 'bold 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`周${DAY_LABELS[d]}`, cx, gridTop + 34);
    ctx.fillStyle = opts.darkMode ? '#94a3b8' : '#64748b';
    ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`${dt.getMonth() + 1}/${dt.getDate()}`, cx, gridTop + 62);
  }

  // Grid lines & Period times
  ctx.strokeStyle = opts.darkMode ? 'rgba(148,163,184,0.14)' : 'rgba(148,163,184,0.2)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < periods.length; i++) {
    const y = gridTop + dayHeaderH + i * rowH;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + gridW, y);
    ctx.stroke();

    const p = periods[i];
    ctx.textAlign = 'center';
    ctx.fillStyle = opts.darkMode ? '#cbd5e1' : '#334155';
    ctx.font = 'bold 24px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(String(p.section), padX + timeColW / 2, y + rowH * 0.44);
    ctx.fillStyle = opts.darkMode ? '#64748b' : '#94a3b8';
    ctx.font = '17px monospace';
    ctx.fillText(p.start, padX + timeColW / 2, y + rowH * 0.75);
  }

  for (let d = 0; d <= 7; d++) {
    const x = padX + timeColW + d * colW;
    ctx.beginPath();
    ctx.moveTo(x, gridTop);
    ctx.lineTo(x, gridTop + gridH);
    ctx.stroke();
  }

  // Draw active courses for the week
  const activeCourses = opts.courses.filter(
    (c) => !c.parseWarning && c.dayOfWeek >= 1 && c.dayOfWeek <= 7 && c.weeks.includes(opts.week)
  );

  ctx.textAlign = 'left';
  for (const c of activeCourses) {
    const pal = getCoursePalette(c.colorIndex, opts.skin);
    const x = padX + timeColW + (c.dayOfWeek - 1) * colW + 5;
    const y = gridTop + dayHeaderH + (c.startSection - 1) * rowH + 5;
    const w = colW - 10;
    const h = (c.endSection - c.startSection + 1) * rowH - 10;

    drawRoundedRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = pal.hexBg;
    ctx.fill();
    ctx.strokeStyle = pal.hexBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = pal.hexTitle;
    ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    const titleLines = wrapTextLines(ctx, c.name, w - 16, h > 220 ? 4 : 3);
    titleLines.forEach((line, idx) => {
      ctx.fillText(line, x + 8, y + 28 + idx * 27);
    });

    ctx.fillStyle = pal.hexSub;
    ctx.font = '19px "PingFang SC", "Microsoft YaHei", sans-serif';
    const locLines = wrapTextLines(ctx, c.location, w - 16, 2);
    const locBaseY = y + h - 12 - (locLines.length - 1) * 23;
    locLines.forEach((line, idx) => {
      ctx.fillText(line, x + 8, locBaseY + idx * 23);
    });
  }

  // Footer watermark
  ctx.textAlign = 'center';
  ctx.fillStyle = opts.darkMode ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.75)';
  ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('谁用你那难用的教务系统？', W / 2, H - (isWallpaper ? 52 : 24));

  return canvas.toDataURL('image/png');
}
