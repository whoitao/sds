import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildTheme, type Theme, type ThemeName } from './theme';

/** 用户在设置页选的主题；system 表示跟随手机外观 */
export type ThemePreference = 'light' | 'dark' | 'system';

/** 存的是用户选择（含 system），不是解析后的明暗，重启后仍然跟随系统 */
const STORAGE_KEY = 'sds.theme.preference';

interface ThemeContextValue {
  theme: Theme;
  /** 等于 theme.colors，组件里最常用的取色入口 */
  colors: Theme['colors'];
  preference: ThemePreference;
  /** 手机当前的外观设置，设置页里用来解释「跟随系统」会变成什么 */
  systemScheme: ThemeName;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme: ThemeName = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // 先按「跟随系统」渲染，读到本地偏好后再切（读取很快，只有一帧的差异）
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!alive) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const theme = useMemo(
    () => buildTheme(preference === 'system' ? systemScheme : preference),
    [preference, systemScheme]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, colors: theme.colors, preference, systemScheme, setPreference }),
    [theme, preference, systemScheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme 必须在 ThemeProvider 内使用');
  return value;
}

/**
 * 主题化样式：把 `StyleSheet.create` 写进 `makeStyles(theme)`，
 * 组件里用 `const styles = useThemedStyles(makeStyles)` 取用。
 * makeStyles 必须是模块级常量，否则每次渲染都会重建样式表。
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const { theme } = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
