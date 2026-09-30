// Brand colors, matching the website and web app (teal #0f766e, mint #5eead4).
export const colors = {
  teal: '#0F766E',
  tealDark: '#115E59',
  mint: '#5EEAD4',
  mintBg: '#CCFBF1',
  bg: '#F9FAFB',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#4B5563',
  border: '#E5E7EB',
  red: '#B91C1C',
  redBg: '#FEE2E2',
  amber: '#92400E',
  amberBg: '#FEF3C7',
  blue: '#1D4ED8',
  blueBg: '#DBEAFE',
  green: '#166534',
  greenBg: '#DCFCE7',
  gray: '#4B5563',
  grayBg: '#F3F4F6',
};

export const STATUS = {
  pending: { label: 'Open', tone: 'amber' },
  accepted: { label: 'Heading to pickup', tone: 'blue' },
  at_pickup: { label: 'At pickup', tone: 'blue' },
  in_transit: { label: 'In transit', tone: 'teal' },
  at_dropoff: { label: 'At drop-off', tone: 'teal' },
  completed: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

export const TONES = {
  amber: [colors.amberBg, colors.amber],
  blue: [colors.blueBg, colors.blue],
  teal: [colors.mintBg, colors.tealDark],
  green: [colors.greenBg, colors.green],
  gray: [colors.grayBg, colors.gray],
  red: [colors.redBg, colors.red],
};
