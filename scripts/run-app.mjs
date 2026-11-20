#!/usr/bin/env node
/**
 * 统一启动器：读取仓库根目录 .env，按 PORT_API / PORT_WEB / PORT_ADMIN / PORT_MOBILE
 * 决定各端端口，缺省时回落到 8787 / 3000 / 3001 / 8081。
 *
 * 用法：node scripts/run-app.mjs <api|web|admin|mobile> <dev|start> [...额外参数]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const IOS_MAP_MODE_FILE = join(cwd, 'ios', '.sds-map-mode');

// 高德 iOS SDK 没有 arm64 模拟器切片，模拟器包必须把高德原生模块移出 Pods（改用 Web 地图）。
// 真机 / EAS 构建仍保留原生地图，所以模式切换时重新 prebuild，避免 Pods 与当前模式不一致。
function ensureIosMapMode(target) {
  const current = existsSync(IOS_MAP_MODE_FILE)
    ? readFileSync(IOS_MAP_MODE_FILE, 'utf8').trim()
    : '';
  if (current === target) return;
  console.log(`[sds] iOS 原生地图模式 → ${target}，重新生成 ios/ …`);
  const result = spawnSync(bin('expo'), ['prebuild', '--platform', 'ios'], {
    cwd,
    env: { ...process.env, SDS_IOS_SIMULATOR: target === 'simulator' ? '1' : '0' },
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error('[sds] iOS prebuild 失败，请先修复上面的错误');
    process.exit(result.status ?? 1);
  }
  writeFileSync(IOS_MAP_MODE_FILE, `${target}\n`);
}

// Android 模拟器访问宿主机只能走 127.0.0.1 + adb reverse。映射绑定在当前 adb 连接上，
// 模拟器重启、adb 重连、expo 内部重启 adb 都会让它消失；所以既在启动前补一次，
// 也在 dev 进程存活期间轮询补齐。不用 `adb wait-for-device` 阻塞：`expo run:android`
// 可能自己负责启动模拟器，轮询能等到设备开机完成（sys.boot_completed=1）后再建映射。
const ANDROID_REVERSE_PORTS = [
  String(process.env.PORT_API || APPS.api.fallback),
  String(process.env.PORT_MOBILE || APPS.mobile.fallback)
];

function adb(args) {
  return spawnSync('adb', args, { encoding: 'utf8' });
}

/** 已连接且完成开机的设备；未就绪的设备不参与映射 */
function readyAndroidDevices() {
  const out = adb(['devices']).stdout ?? '';
  return out
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
    .filter(
      (serial) =>
        (adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).stdout ?? '').trim() === '1'
    );
}

/** 设备上已建立的 reverse 端口集合 */
function reversedPorts(serial) {
  const out = adb(['-s', serial, 'reverse', '--list']).stdout ?? '';
  return new Set(
    out
      .split('\n')
      .map((line) => line.match(/tcp:(\d+)\s+tcp:(\d+)/))
      .filter(Boolean)
      .map((match) => match[1])
  );
}

function ensureAndroidReverse({ quiet = false } = {}) {
  const devices = readyAndroidDevices();
  if (!devices.length) return;
  for (const serial of devices) {
    const existing = reversedPorts(serial);
    for (const port of ANDROID_REVERSE_PORTS) {
      if (existing.has(port)) continue;
      const result = adb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
      if (result.status === 0) {
        console.log(`[sds] Android 端口转发 ${serial} → localhost:${port}`);
      } else if (!quiet) {
        const reason = (result.stderr ?? '').trim() || 'adb 未就绪，稍后重试';
        console.warn(`[sds] Android 端口转发失败（${serial}:${port}）: ${reason}`);
      }
    }
  }
}

let androidReverseTimer = null;
function startAndroidReverseWatch() {
  ensureAndroidReverse();
  androidReverseTimer = setInterval(() => ensureAndroidReverse({ quiet: true }), 5000);
}

let command;
let args;
let extraEnv = {};
if (appName === 'api') {
  command = bin('tsx');
  args = mode === 'start' ? ['src/index.ts'] : ['watch', 'src/index.ts'];
} else if (appName === 'mobile' && mode === 'build') {
  // EAS --local 不读取云端 Secret，统一从根 .env / 当前 shell 注入原生 Key
  command = bin('eas');
  args = ['build', ...rest];
} else if (appName === 'mobile') {
  command = bin('expo');
  // 含原生模块（expo-gaode-map）时 Expo Go 无法加载：带平台参数时走 dev build，
  // run:android / run:ios 会自动 prebuild + 构建 + 安装 + 启动，不需要手动先装 APK。
  const platform = rest.includes('--android') ? 'android' : rest.includes('--ios') ? 'ios' : null;
  if (platform) {
    if (platform === 'ios') {
      const device = rest.includes('--device');
      const mapMode = device ? 'device' : 'simulator';
      ensureIosMapMode(mapMode);
      extraEnv = { SDS_IOS_SIMULATOR: mapMode === 'simulator' ? '1' : '0' };
    }
    args = [`run:${platform}`, ...rest.filter((arg) => arg !== `--${platform}`)];
  } else {
    args = ['start', '--dev-client', '--port', port, ...rest];
  }
} else {
  command = bin('next');
  args = [mode === 'start' ? 'start' : 'dev', '-p', port];
}

const env = { ...process.env, PORT: port, ...extraEnv };
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
