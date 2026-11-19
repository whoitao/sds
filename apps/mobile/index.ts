import { registerRootComponent } from 'expo';
import { createElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './App';

// 安全区 inset 统一由 SafeAreaProvider 提供，安卓 edge-to-edge 下也能拿到导航条高度
registerRootComponent(() => createElement(SafeAreaProvider, null, createElement(App)));
