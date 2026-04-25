import logoSrc from '../assets/logo.png';

interface Props {
  size?: number;
  className?: string;
}

export function CanopyLogo({ size = 32, className = '' }: Props) {
  return (
    <img
      src={logoSrc}
      width={size}
      height={size}
      alt="CanopyTag"
      className={`object-contain ${className}`}
    />
  );
}
