module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    [
      'expo-gaode-map',
      {
        androidKey: process.env.GAODE_ANDROID_KEY,
        iosKey: process.env.GAODE_IOS_KEY,
        // 定位仍由现有 expo-location 流程负责，原生地图只展示 GCJ-02 坐标
        enableLocation: false
      }
    ]
  ]
});
