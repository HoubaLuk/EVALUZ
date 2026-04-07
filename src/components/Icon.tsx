// Wrapper komponenta pro FontAwesome ikony
// Nahrazuje Lucide React — umožňuje snadný přechod nebo budoucí výměnu knihovny
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { SizeProp } from '@fortawesome/fontawesome-svg-core';

interface IconProps {
  icon: IconDefinition;
  className?: string;
  size?: SizeProp;
  spin?: boolean;
  style?: React.CSSProperties;
  title?: string;
}

export function Icon({ icon, className, size, spin, style, title }: IconProps) {
  return (
    <FontAwesomeIcon
      icon={icon}
      className={className}
      size={size}
      spin={spin}
      style={style}
      title={title}
    />
  );
}
