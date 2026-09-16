import logoSrc from '../assets/logo.png';

interface Props {
  size?: number;
  className?: string;
}

export function CanopyLogo({ size = 32, className = '' }: Props) {
  return (
    <span
      role="img"
      aria-label="CanopyTag"
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: 'var(--color-logo)',
        WebkitMaskImage: `url(${logoSrc})`,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskImage: `url(${logoSrc})`,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: 'contain',
      }}
    />
  );
}
