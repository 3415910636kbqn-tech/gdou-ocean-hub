import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { EphemeralCookieJar } from './ephemeralCookieJar';
import {
  checkCaptcha,
  completeWfwSubAuthSync,
  executeDirectLoginSync,
  fetchCaptchaImage,
  MfaChallengeState,
  PreparedAuthSession,
  prepareSession,
  sendMfaCode,
  submitMfaAndSync,
  WfwSubAuthState,
} from './gdouSyncEngine';
import { GDOU_AUTH_WFW_BASE, GDOU_AUTH_PATHS } from '../shared/gdouEndpoints';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

// Simple per-IP rate limiter for /api/sync/* (max 30 requests / minute)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
app.use('/api/sync', (req, res, next) => {
  const ip = req.ip || 'local';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  bucket.count += 1;
  if (bucket.count > 30) {
    res.status(429).json({ error: '请求过于频繁，请 1 分钟后再试' });
    return;
  }
  next();
});

interface EphemeralSessionEntry {
  id: string;
  jar: EphemeralCookieJar;
  prepared: PreparedAuthSession;
  mfa?: MfaChallengeState;
  subAuth?: WfwSubAuthState;
  expiresAt: number;
}

const SESSION_TTL_MS = 3 * 60 * 1000; // 3 minutes strict TTL
const sessions = new Map<string, EphemeralSessionEntry>();

function destroySession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.jar.wipe();
    sessions.delete(sessionId);
  }
}

// Sweep expired sessions every 30s
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions.entries()) {
    if (entry.expiresAt <= now) {
      entry.jar.wipe();
      sessions.delete(id);
    }
  }
}, 30_000).unref();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, zeroRetention: true, activeEphemeralSessions: sessions.size });
});

app.post('/api/sync/prepare', async (_req, res) => {
  const jar = new EphemeralCookieJar();
  try {
    const prepared = await prepareSession(jar);
    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions.set(sessionId, {
      id: sessionId,
      jar,
      prepared,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    res.json({
      sessionId,
      isWebVpn: prepared.isWebVpn,
      networkRoute: prepared.isWebVpn ? 'wfw-webvpn' : 'campus-direct',
      pwdEncryptSalt: prepared.pwdEncryptSalt,
    });
  } catch (err) {
    jar.wipe();
    res.status(502).json({
      error: err instanceof Error ? err.message : '连接海大教务认证入口失败，请检查网络',
    });
  }
});

app.post('/api/sync/captcha', async (req, res) => {
  const { sessionId, username, forceRefresh } = req.body as {
    sessionId?: string;
    username?: string;
    forceRefresh?: boolean;
  };
  const entry = sessionId ? sessions.get(sessionId) : undefined;
  if (!entry) {
    res.status(400).json({ error: '同步会话已过期，请点击重新连接' });
    return;
  }
  entry.expiresAt = Date.now() + SESSION_TTL_MS;

  try {
    if (forceRefresh) {
      const origin = entry.subAuth ? GDOU_AUTH_WFW_BASE : entry.prepared.authOrigin;
      const referer = entry.subAuth
        ? `${GDOU_AUTH_WFW_BASE}${GDOU_AUTH_PATHS.login}`
        : entry.prepared.entryFinalUrl;
      const imageDataUri = await fetchCaptchaImage(entry.jar, origin, referer);
      res.json({ isNeed: Boolean(imageDataUri), imageDataUri });
      return;
    }
    const result = await checkCaptcha(entry.jar, entry.prepared, username || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : '获取验证码失败',
    });
  }
});

app.post('/api/sync/login', async (req, res) => {
  const { sessionId, username, password, encryptedPassword, captcha, xnm, xqm } = req.body as {
    sessionId?: string;
    username?: string;
    password?: string;
    encryptedPassword?: string;
    captcha?: string;
    xnm?: string;
    xqm?: string;
  };
  const entry = sessionId ? sessions.get(sessionId) : undefined;
  if (!entry) {
    res.status(400).json({ error: '同步会话已过期，请重新连接教务通道' });
    return;
  }
  if (!username?.trim() || (!encryptedPassword && !password)) {
    res.status(400).json({ error: '请输入学号与统一身份认证密码' });
    return;
  }
  entry.expiresAt = Date.now() + SESSION_TTL_MS;

  try {
    const outcome = await executeDirectLoginSync(
      entry.jar,
      entry.prepared,
      { username, password, encryptedPassword, captcha },
      xnm || xqm ? { xnm, xqm } : undefined
    );

    if (outcome.status === 'mfa_required') {
      entry.mfa = outcome.mfa;
      res.json({
        status: 'mfa_required',
        defaultReAuthType: outcome.mfa.defaultReAuthType,
        steps: outcome.mfa.previousSteps,
      });
      return;
    }

    if (outcome.status === 'wfw_subauth_required') {
      entry.subAuth = outcome.subAuth;
      res.json({
        status: 'wfw_subauth_required',
        salt2: outcome.subAuth.salt2,
        needCaptcha: outcome.subAuth.needCaptcha,
        captchaImageUri: outcome.subAuth.captchaImageUri,
        steps: outcome.subAuth.previousSteps,
      });
      return;
    }

    if (outcome.status === 'completed') {
      destroySession(entry.id);
      res.json({ status: 'completed', result: outcome.result });
      return;
    }

    res.json(outcome);
  } catch (err) {
    destroySession(entry.id);
    res.status(400).json({ error: err instanceof Error ? err.message : '同步失败' });
  }
});

app.post('/api/sync/mfa/send', async (req, res) => {
  const { sessionId, reAuthType } = req.body as { sessionId?: string; reAuthType?: '4' | '3' };
  const entry = sessionId ? sessions.get(sessionId) : undefined;
  if (!entry || !entry.mfa) {
    res.status(400).json({ error: '多因子认证会话已过期，请重新发起同步' });
    return;
  }
  entry.expiresAt = Date.now() + SESSION_TTL_MS;

  try {
    const message = await sendMfaCode(entry.jar, entry.mfa, reAuthType === '3' ? '3' : '4');
    res.json({ ok: true, message });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '发送验证码失败' });
  }
});

app.post('/api/sync/mfa/submit', async (req, res) => {
  const { sessionId, dynamicCode, reAuthType, xnm, xqm } = req.body as {
    sessionId?: string;
    dynamicCode?: string;
    reAuthType?: '4' | '3';
    xnm?: string;
    xqm?: string;
  };
  const entry = sessionId ? sessions.get(sessionId) : undefined;
  if (!entry || !entry.mfa) {
    res.status(400).json({ error: '多因子认证会话已过期，请重新发起同步' });
    return;
  }
  if (!dynamicCode?.trim()) {
    res.status(400).json({ error: '请输入收到的验证码' });
    return;
  }
  entry.expiresAt = Date.now() + SESSION_TTL_MS;

  try {
    const outcome = await submitMfaAndSync(
      entry.jar,
      entry.mfa,
      dynamicCode,
      reAuthType === '3' ? '3' : '4',
      xnm || xqm ? { xnm, xqm } : undefined
    );

    if (outcome.status === 'mfa_required') {
      entry.mfa = outcome.mfa;
      res.json({
        status: 'mfa_required',
        defaultReAuthType: outcome.mfa.defaultReAuthType,
        steps: outcome.mfa.previousSteps,
      });
      return;
    }

    if (outcome.status === 'wfw_subauth_required') {
      entry.subAuth = outcome.subAuth;
      res.json({
        status: 'wfw_subauth_required',
        salt2: outcome.subAuth.salt2,
        needCaptcha: outcome.subAuth.needCaptcha,
        captchaImageUri: outcome.subAuth.captchaImageUri,
        steps: outcome.subAuth.previousSteps,
      });
      return;
    }

    if (outcome.status === 'completed') {
      destroySession(entry.id);
      res.json({ status: 'completed', result: outcome.result });
      return;
    }

    res.json(outcome);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '验证码校验失败' });
  }
});

app.post('/api/sync/wfw-subauth', async (req, res) => {
  const { sessionId, password, encryptedPassword, captcha, xnm, xqm } = req.body as {
    sessionId?: string;
    password?: string;
    encryptedPassword?: string;
    captcha?: string;
    xnm?: string;
    xqm?: string;
  };
  const entry = sessionId ? sessions.get(sessionId) : undefined;
  if (!entry || !entry.subAuth) {
    res.status(400).json({ error: '校外子会话已过期，请重新发起同步' });
    return;
  }
  if (!encryptedPassword && !password) {
    res.status(400).json({ error: '请重新输入一次统一身份认证密码以激活教务子会话' });
    return;
  }

  try {
    const outcome = await completeWfwSubAuthSync(
      entry.jar,
      entry.subAuth,
      { username: entry.subAuth.username, password, encryptedPassword, captcha },
      xnm || xqm ? { xnm, xqm } : undefined
    );

    if (outcome.status === 'mfa_required') {
      entry.mfa = outcome.mfa;
      res.json({
        status: 'mfa_required',
        defaultReAuthType: outcome.mfa.defaultReAuthType,
        steps: outcome.mfa.previousSteps,
      });
      return;
    }

    if (outcome.status === 'completed') {
      destroySession(entry.id);
      res.json({ status: 'completed', result: outcome.result });
      return;
    }

    res.json(outcome);
  } catch (err) {
    destroySession(entry.id);
    res.status(400).json({ error: err instanceof Error ? err.message : '校外子会话验证失败' });
  }
});

app.post('/api/sync/cancel', (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) destroySession(sessionId);
  res.json({ ok: true });
});

// Serve native Android APK / iOS IPA downloads & AltStore/version JSON manifests
const downloadsDir = path.resolve(process.cwd(), 'downloads');
if (fs.existsSync(downloadsDir)) {
  app.use(
    '/downloads',
    express.static(downloadsDir, {
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-cache');
          return;
        }
        if (name.endsWith('.png')) {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return;
        }
        if (name.endsWith('.apk')) {
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        } else if (name.endsWith('.ipa')) {
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
}

// Production static files serving if dist/ exists
const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`[GDOU Ocean Hub] Zero-retention local sync server running on http://${HOST}:${PORT}`);
});
