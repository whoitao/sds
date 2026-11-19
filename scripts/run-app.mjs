#!/usr/bin/env node
/**
 * 统一启动器：读取仓库根目录 .env，按 PORT_API / PORT_WEB / PORT_ADMIN / PORT_MOBILE
 * 决定各端端口，缺省时回落到 8787 / 3000 / 3001 / 8081。
 *
 * 用法：node scripts/run-app.mjs <api|web|admin|mobile> <dev|start> [...额外参数]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 根 .env 只是默认值来源，已存在的环境变量优先
function loadRootEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      /* 继续走下面的兜底解析 */
    }
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const APPS = {
  api: { dir: 'packages/api', portKey: 'PORT_API', fallback: 8787 },
  web: { dir: 'apps/web', portKey: 'PORT_WEB', fallback: 3000 },
  admin: { dir: 'apps/admin', portKey: 'PORT_ADMIN', fallback: 3001 },
  mobile: { dir: 'apps/mobile', portKey: 'PORT_MOBILE', fallback: 8081 }
};

const [appName, mode = 'dev', ...rest] = process.argv.slice(2);
const app = APPS[appName];
if (!app) {
  console.error(`用法: node scripts/run-app.mjs <${Object.keys(APPS).join('|')}> <dev|start>`);
  process.exit(1);
}

loadRootEnv();

const port = String(process.env[app.portKey] || app.fallback);
const cwd = join(ROOT, app.dir);

function bin(name) {
  const local = join(cwd, 'node_modules', '.bin', name);
  return existsSync(local) ? local : join(ROOT, 'node_modules', '.bin', name);
}

let command;
let args;
if (appName === 'api') {
  command = bin('tsx');
  args = mode === 'start' ? ['src/index.ts'] : ['watch', 'src/index.ts'];
} else if (appName === 'mobile') {
  command = bin('expo');
  args = ['start', '--port', port, ...rest];
} else {
  command = bin('next');
  args = [mode === 'start' ? 'start' : 'dev', '-p', port];
}

const env = { ...process.env, PORT: port };
// admin 端拿不到根 .env 时，用 PORT_API 派生 API 地址
if (appName === 'admin' && !env.API_BASE_URL) {
  env.API_BASE_URL = `http://localhost:${process.env.PORT_API || APPS.api.fallback}`;
}

console.log(`[sds] ${appName} ${mode} → 端口 ${port}`);

// Android 模拟器通过设备 localhost 访问宿主机 API，启动 Expo 前建立端口转发。
if (appName === 'mobile' && rest.includes('--android')) {
  const apiPort = String(process.env.PORT_API || APPS.api.fallback);
  const result = spawnSync('adb', ['reverse', `tcp:${apiPort}`, `tcp:${apiPort}`], {
    stdio: 'inherit'
  });
  if (result.status === 0) {
    console.log(`[sds] Android API 转发 → localhost:${apiPort}`);
  } else {
    console.warn('[sds] ADB 端口转发未建立，请确认 Android 模拟器已启动且 adb 可用');
  }
}

const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
child.on('error', (err) => {
  console.error(`[sds] 启动失败: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
