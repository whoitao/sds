import { colors, fontSize } from './tokens';

export * from './tokens';

export interface HelloCardProps {
  title: string;
  description?: string;
}

/** 三端复用的 HelloWorld 卡片，仅用于验证共享 UI 包可被消费 */
export function HelloCard({ title, description }: HelloCardProps) {
  return (
    <div
      style={{
        background: '#ffffff',
        border: `1px solid ${colors.brand}33`,
        borderRadius: 12,
        padding: 24,
        maxWidth: 420
      }}
    >
      <h1 style={{ margin: 0, fontSize: fontSize.xl, color: colors.text }}>{title}</h1>
      {description ? (
        <p style={{ marginTop: 12, fontSize: fontSize.base, color: colors.textSecondary }}>{description}</p>
      ) : null}
    </div>
  );
}
