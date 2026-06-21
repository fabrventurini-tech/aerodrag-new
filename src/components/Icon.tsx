import React from 'react';
import Svg, {
  Path, Circle, Rect, Line, Polyline,
} from 'react-native-svg';
import { Colors } from '../theme';

export type IconName =
  | 'live' | 'session' | 'coach' | 'athletes' | 'settings'
  | 'home' | 'road' | 'check' | 'record' | 'stop' | 'flag' | 'target';

interface Props {
  name:         IconName;
  size?:        number;
  color?:       string;
  strokeWidth?: number;
  /** riempi invece di tracciare (es. REC) */
  filled?:      boolean;
}

// Icone stroke 24×24, viewBox uniforme. Nessuna emoji nella UI.
export function Icon({ name, size = 22, color = Colors.muted, strokeWidth = 2, filled = false }: Props) {
  const common = {
    stroke:        color,
    strokeWidth,
    fill:          'none' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin:'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'live' && (
        // pulse / activity
        <Polyline points="2,12 7,12 10,5 14,19 17,12 22,12" {...common} />
      )}

      {name === 'session' && (
        // bar chart
        <>
          <Line x1="4"  y1="20" x2="4"  y2="11" {...common} />
          <Line x1="10" y1="20" x2="10" y2="4"  {...common} />
          <Line x1="16" y1="20" x2="16" y2="8"  {...common} />
          <Line x1="22" y1="20" x2="2"  y2="20" {...common} />
        </>
      )}

      {name === 'coach' && (
        // broadcast / rss
        <>
          <Circle cx="5" cy="19" r="1.6" fill={color} stroke="none" />
          <Path d="M4 11a8 8 0 0 1 8 8"   {...common} />
          <Path d="M4 5a14 14 0 0 1 14 14" {...common} />
        </>
      )}

      {name === 'athletes' && (
        // user
        <>
          <Circle cx="12" cy="8" r="4" {...common} />
          <Path d="M4 21c0-4 3.6-6.5 8-6.5S20 17 20 21" {...common} />
        </>
      )}

      {name === 'settings' && (
        // gear
        <>
          <Circle cx="12" cy="12" r="3" {...common} />
          <Path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"
            {...common}
          />
        </>
      )}

      {name === 'home' && (
        <>
          <Path d="M3 11l9-7 9 7" {...common} />
          <Path d="M5 10v10h14V10" {...common} />
        </>
      )}

      {name === 'road' && (
        <>
          <Path d="M7 3 4 21M17 3l3 18" {...common} />
          <Line x1="12" y1="4"  x2="12" y2="8"  {...common} />
          <Line x1="12" y1="11" x2="12" y2="15" {...common} />
          <Line x1="12" y1="18" x2="12" y2="21" {...common} />
        </>
      )}

      {name === 'check' && (
        <Polyline points="4,12 10,18 20,6" {...common} />
      )}

      {name === 'record' && (
        <Circle cx="12" cy="12" r="7" fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} />
      )}

      {name === 'stop' && (
        <Rect x="6" y="6" width="12" height="12" rx="2" fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} />
      )}

      {name === 'flag' && (
        <>
          <Line x1="5" y1="3" x2="5" y2="21" {...common} />
          <Path d="M5 4h12l-2.5 4L17 12H5" {...common} />
        </>
      )}

      {name === 'target' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Circle cx="12" cy="12" r="3.5" {...common} />
        </>
      )}
    </Svg>
  );
}
