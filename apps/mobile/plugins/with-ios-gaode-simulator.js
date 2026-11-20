const { withPodfile } = require('@expo/config-plugins');

/**
 * 只在本地 iOS 模拟器构建里把高德原生模块移出 Pods。
 *
 * 原因：AMap 的 framework 只有 x86_64 + device arm64 切片，没有 arm64 模拟器切片，
 * 而 iOS 26+ 的模拟器运行时只支持 arm64。CocoaPods 为模拟器保留 x86_64 并写入
 * EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64，app 在模拟器上就没有可用架构，
 * xcodebuild 直接判定「不支持 iOS Simulator」。模拟器上改用 Web 地图（ShopWebMap）。
 *
 * 真机 / EAS 构建不设置 SDS_IOS_SIMULATOR，仍然完整链接 expo-gaode-map。
 */
module.exports = function withIosGaodeSimulator(config) {
  if (process.env.SDS_IOS_SIMULATOR !== '1') {
    return config;
  }

  return withPodfile(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /^(\s*)use_expo_modules!\s*$/m,
      "$1use_expo_modules!(exclude: ['expo-gaode-map'])"
    );
    return cfg;
  });
};
