import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 本地开发便利：若仓库根目录存在 .env 则自动加载。
 * Node 18 无 process.loadEnvFile，此时忽略，需自行 export 环境变量。
 */
const rootEnvPath = fileURLToPath(new URL('../../../../.env', import.meta.url));

if (typeof process.loadEnvFile === 'function' && existsSync(rootEnvPath)) {
  try {
    process.loadEnvFile(rootEnvPath);
  } catch {
    // 忽略加载失败，交由各接口在缺少配置时给出明确错误
  }
}
