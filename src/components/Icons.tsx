// Small monochrome icons, so nothing depends on coloured emoji fonts.

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const RepeatIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M3 7V6a2 2 0 0 1 2-2h8M11 2l2 2-2 2" />
    <path d="M13 9v1a2 2 0 0 1-2 2H3M5 14l-2-2 2-2" />
  </svg>
);

export const RepeatOneIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M3 7V6a2 2 0 0 1 2-2h8M11 2l2 2-2 2" />
    <path d="M13 9v1a2 2 0 0 1-2 2H3M5 14l-2-2 2-2" />
    <path d="M7.4 6.6 8.4 6v4" strokeWidth={1.4} />
  </svg>
);

export const ShuffleIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M2 4h2.5c1.2 0 2.2.6 2.9 1.6l3.2 4.8c.7 1 1.7 1.6 2.9 1.6H14" />
    <path d="M2 12h2.5c1.2 0 2.2-.6 2.9-1.6l.6-.9M10.4 6.5l.2-.3c.7-1 1.7-1.6 2.9-1.6H14" />
    <path d="M12 2.5 14 4l-2 1.5M12 10.5 14 12l-2 1.5" />
  </svg>
);

export const PinIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M9.5 2.5 13.5 6.5 11 7l-2.5 2.5V13L6 10.5 2.5 14M6 10.5l3-3" />
    <path d="M9 4 12 7" />
  </svg>
);

export const MiniIcon = () => (
  <svg {...base} aria-hidden>
    <rect x="2" y="3" width="12" height="9" rx="1.5" />
    <rect x="7.5" y="8" width="6.5" height="4" rx="1" fill="currentColor" stroke="none" />
    <path d="M5 6.5h3" />
  </svg>
);

export const VolumeIcon = ({ muted }: { muted?: boolean }) => (
  <svg {...base} aria-hidden>
    <path d="M2.5 6.5h2.5L8.5 4v8L5 9.5H2.5z" fill="currentColor" stroke="none" />
    {muted ? <path d="M10.5 6l3 4M13.5 6l-3 4" /> : <path d="M10.5 6a3 3 0 0 1 0 4M12.3 4.3a5.5 5.5 0 0 1 0 7.4" />}
  </svg>
);

export const OpacityWindowIcon = () => (
  <svg {...base} aria-hidden>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 8h12M8 3v10" strokeWidth={1} opacity={0.5} />
  </svg>
);

export const OpacityBackgroundIcon = () => (
  <svg {...base} aria-hidden>
    <rect x="2" y="3" width="12" height="10" rx="1.5" strokeDasharray="2 2" />
    <path d="M5 8h6" strokeWidth={2.2} />
  </svg>
);

export const PlayOutlineIcon = () => (
  <svg {...base} width={18} height={18} aria-hidden>
    <path d="M5.5 3.5v9l7.5-4.5z" strokeWidth={1.4} />
  </svg>
);

export const PauseOutlineIcon = () => (
  <svg {...base} width={18} height={18} aria-hidden>
    <rect x="4" y="3.5" width="3" height="9" rx="0.8" strokeWidth={1.4} />
    <rect x="9" y="3.5" width="3" height="9" rx="0.8" strokeWidth={1.4} />
  </svg>
);

export const PrevIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M4.5 3.5v9" strokeWidth={1.8} />
    <path d="M12 3.8v8.4L6 8z" fill="currentColor" stroke="none" />
  </svg>
);

export const NextIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M11.5 3.5v9" strokeWidth={1.8} />
    <path d="M4 3.8v8.4L10 8z" fill="currentColor" stroke="none" />
  </svg>
);

/** Filled play triangle, shifted right so it looks centred in a round key. */
export const PlayFillIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
    <path d="M5.6 3.2v9.6c0 .5.5.8.9.5l7-4.8c.4-.3.4-.8 0-1l-7-4.8c-.4-.3-.9 0-.9.5z" fill="currentColor" stroke="none" />
  </svg>
);

export const PauseFillIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
    <rect x="4.2" y="3" width="2.6" height="10" rx="0.9" fill="currentColor" stroke="none" />
    <rect x="9.2" y="3" width="2.6" height="10" rx="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const ChevronLeftIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M9.8 3.8 5.6 8l4.2 4.2" strokeWidth={1.9} />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M6.2 3.8 10.4 8l-4.2 4.2" strokeWidth={1.9} />
  </svg>
);
