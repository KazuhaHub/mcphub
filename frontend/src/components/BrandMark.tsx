import React from 'react';
import { useBranding } from '@/contexts/BrandingContext';
import { useTheme } from '@/contexts/ThemeContext';

/** The wide logo for the current theme (dark falls back to light), or '' when none is set. */
export const useBrandLogo = (): string => {
  const { branding } = useBranding();
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? branding.logoDark || branding.logoLight : branding.logoLight;
};

interface BrandMarkProps {
  /** `gradient` is the sidebar tile; `ink` is the larger login/consent tile. */
  variant: 'gradient' | 'ink';
  statusDot?: boolean;
}

/**
 * The square brand mark. Shows the uploaded icon when there is one (rendered only through
 * an <img>, so SVG scripts never run) and the "M" tile otherwise.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ variant, statusDot = true }) => {
  const { branding } = useBranding();
  const gradient = variant === 'gradient';
  const size = gradient ? 28 : 44;

  const dot = statusDot ? (
    gradient ? (
      <span
        className="absolute -right-0.5 -bottom-0.5 w-[6px] h-[6px] rounded-full"
        style={{
          background: 'var(--hub-ok)',
          boxShadow: '0 0 0 2px oklch(0.66 0.15 145 / 0.18)',
        }}
      />
    ) : (
      <span
        className="absolute"
        style={{
          right: -2,
          bottom: -2,
          width: 8,
          height: 8,
          borderRadius: 50,
          background: 'var(--hub-ok)',
          boxShadow: '0 0 0 3px var(--hub-bg)',
        }}
      />
    )
  ) : null;

  if (branding.icon) {
    return (
      <div
        className="relative shrink-0"
        data-brand-mark="icon"
        style={{ width: size, height: size }}
      >
        <img
          src={branding.icon}
          alt=""
          className="h-full w-full object-contain"
          style={{ borderRadius: gradient ? 6 : 10 }}
          draggable={false}
        />
        {dot}
      </div>
    );
  }

  if (gradient) {
    return (
      <div
        className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md text-white hub-mono text-[12px] font-semibold"
        data-brand-mark="tile"
        style={{
          background: 'linear-gradient(135deg, var(--hub-accent), oklch(0.62 0.18 285))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)',
        }}
      >
        <span>M</span>
        {dot}
      </div>
    );
  }

  return (
    <div
      className="relative grid place-items-center"
      data-brand-mark="tile"
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: 'var(--hub-ink)',
        color: 'var(--hub-bg)',
      }}
    >
      <span className="hub-mono font-semibold" style={{ fontSize: 18 }}>
        M
      </span>
      {dot}
    </div>
  );
};

export default BrandMark;
