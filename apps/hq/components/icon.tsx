import type { SVGProps } from 'react';

export type IconName =
  | 'activity'
  | 'analytics'
  | 'book'
  | 'brand'
  | 'campaign'
  | 'chevron'
  | 'close'
  | 'dashboard'
  | 'drop'
  | 'external'
  | 'folder'
  | 'help'
  | 'integrations'
  | 'kiosk'
  | 'lock'
  | 'locations'
  | 'menu'
  | 'onboarding'
  | 'panel'
  | 'plus'
  | 'search'
  | 'settings'
  | 'training'
  | 'upload'
  | 'users'
  | 'wall';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName;
  size?: number;
};

const paths: Record<IconName, readonly string[]> = {
  activity: ['M3 12h4l2.2-7 4.4 14L16.8 12H21'],
  analytics: ['M4 19V9', 'M10 19V4', 'M16 19v-7', 'M22 19V7'],
  book: ['M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5z', 'M5 4.5v17', 'M9 6h7'],
  brand: ['M12 3 4 7v10l8 4 8-4V7z', 'M4 7l8 4 8-4', 'M12 11v10'],
  campaign: ['M4 13V9l12-4v12L4 13z', 'M8 13l1.5 7h3L11 12', 'M18 9v4'],
  chevron: ['m8 10 4 4 4-4'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  dashboard: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  drop: ['M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z', 'M9 15.2a3.3 3.3 0 0 0 3 1.8'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 13v6H5V6h6'],
  folder: ['M3 6.5h6l2 2h10v10.5H3z'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.7 9a2.4 2.4 0 1 1 4.2 1.6c-.9.8-1.9 1.3-1.9 2.7', 'M12 17h.01'],
  integrations: ['M8 12h8', 'M12 8v8', 'M5 4h5v4H5z', 'M14 16h5v4h-5z', 'M14 4h5v4h-5z', 'M5 16h5v4H5z'],
  kiosk: ['M4 4h16v13H4z', 'M8 21h8', 'M12 17v4', 'M8 8h8', 'M8 12h5'],
  lock: ['M6 10h12v10H6z', 'M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10', 'M12 14v2'],
  locations: ['M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z', 'M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  menu: ['M4 5h16', 'M4 12h16', 'M4 19h16'],
  onboarding: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'm5.6 5.6 2.8-2.8', 'm15.6 8.4 2.8-2.8', 'm5.6 6.4 2.8 2.8', 'm15.6 15.6 2.8 2.8'],
  panel: ['M4 4h16v16H4z', 'M9 4v16'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['m21 21-4.4-4.4', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z'],
  settings: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H6v-2.4h.8a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L8 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V14h-.2a1.7 1.7 0 0 0-1.6 1z'],
  training: ['M4 5h16v11H4z', 'M8 20h8', 'M12 16v4', 'm8 9 2.5 2.5L16 7'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M5 15v5h14v-5'],
  users: ['M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20', 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M17 11a3 3 0 0 0 0-6', 'M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.4'],
  wall: ['M4 4h16v16H4z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
};

export function Icon({ name, size = 18, className, ...props }: IconProps) {
  return (
    <svg
      {...props}
      className={className ?? 'nav-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}
