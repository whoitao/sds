import type { ConfigContext, ExpoConfig } from 'expo/config';
import appJson from './app.json';

/**
 * 动态配置：高德原生 SDK 的 Key 只能从环境变量注入，避免把 Key 写进提交的 app.json。
 * 根目录 .env 里的 GAODE_ANDROID_KEY / GAODE_IOS_KEY 由 scripts/run-app.mjs 注入到进程环境，
 * EAS 构建时通过 eas.json / 项目环境变量提供。
 * 缺少 Key 时不挂插件（应用仍能启动，地图页会提示未配置），不会中断 prebuild。
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as unknown as ExpoConfig;
  const androidKey = process.env.GAODE_ANDROID_KEY?.trim();
  const iosKey = process.env.GAODE_IOS_KEY?.trim();

  const plugins: NonNullable<ExpoConfig['plugins']> = [
    ...(base.plugins ?? []),
    './plugins/with-gradle-heap',
    './plugins/with-ios-gaode-simulator'
  ];
  if (androidKey || iosKey) {
    plugins.push([
      'expo-gaode-map',
      {
        ...(androidKey ? { androidKey } : {}),
        ...(iosKey ? { iosKey } : {}),
        locationDescription: '用于查找离您最近的门店；不授权也可以按店名、街道或小区找店。'
      }
    ]);
  }

  return {
    ...config,
    ...base,
    plugins
  };
};
