const { withGradleProperties } = require('@expo/config-plugins');

const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

/**
 * Gradle 默认 2g 堆在 JetifyTransform 处理 react-android 的 aar 时会 OOM，
 * 这里统一调高 debug/release 的 Gradle 守护进程堆，CNG 重新 prebuild 后仍然生效。
 */
module.exports = function withGradleHeap(config) {
  return withGradleProperties(config, (cfg) => {
    const items = cfg.modResults;
    const existing = items.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs'
    );
    if (existing) {
      existing.value = JVM_ARGS;
    } else {
      items.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    }
    return cfg;
  });
};
