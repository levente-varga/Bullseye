/** Minimal 16px line icons (stroke = currentColor). */
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "square" as const,
  "aria-hidden": true,
  ...props,
});

/** The Bullseye logo: concentric rings with a solid center. */
export const IconBullseye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.75" />
    <circle cx="8" cy="8" r="4.25" />
    <circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none" />
  </svg>
);
export const IconInbox = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    {/* One closed outline (its corners join), and the tray line ending flat inside the walls. */}
    <path d="M2 9.5L4 3H12L14 9.5V13.5H2Z" />
    <path strokeLinecap="butt" d="M2 9.5H5.5L6.5 11H9.5L10.5 9.5H14" />
  </svg>
);
/** A pipe tee seen from the side, branch to the right, with flanges on its three ends. */
export const IconPipeline = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    {/* Filled, not stroked: every edge sits on the 16px grid, so it draws crisp at 1x. */}
    <path fill="currentColor" stroke="none" d="M3 3h1v10h-1ZM6 3h1v4h-1ZM6 9h1v4h-1ZM7 6h5v1h-5ZM7 9h5v1h-5ZM2 1h6v2h-6ZM2 13h6v2h-6ZM12 5h2v6h-2Z" />
  </svg>
);
export const IconSliders = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2 4h7M12 4h2M2 12h2M7 12h7M2 8h4M9 8h5" />
    <rect x="9" y="2.5" width="3" height="3" />
    <rect x="4" y="10.5" width="3" height="3" />
    <rect x="6" y="6.5" width="3" height="3" />
  </svg>
);
/** A globe: sources are the sites jobs come from. */
export const IconSources = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.5" />
    <ellipse cx="8" cy="8" rx="2.75" ry="6.5" />
    <path d="M2 8H14" />
  </svg>
);
export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="5.5" r="2.75" />
    <path d="M2.5 14c.6-2.8 2.8-4.25 5.5-4.25S12.9 11.2 13.5 14" />
  </svg>
);
export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.5 14c.5-2.6 2.3-4 4.5-4s4 1.4 4.5 4" />
    <path d="M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 10.3c1.3.5 2.2 1.7 2.5 3.7" />
  </svg>
);
export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2 2v12h12" />
    <path d="M5 10.5l2.5-3 2 2L13 5" />
  </svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13.5 9.5A5.75 5.75 0 016.5 2.5a5.75 5.75 0 107 7z" />
  </svg>
);
export const IconMonitor = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="1.5" y="2.5" width="13" height="8.5" />
    <path d="M5.5 14h5M8 11v3" />
  </svg>
);
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </svg>
);
export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, ...p })}>
    <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 10v3.5H2.5V4H6" />
  </svg>
);
/** Re-run: a circular arrow. */
export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v2.5h-2.5" />
  </svg>
);
/** Delete: a bin with a lid. */
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />
  </svg>
);
export const IconPencil = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5zM8.5 4.5l3 3" />
  </svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
/** Watch: outlined, or `filled` while watching (in the current colour). */
export const IconStar = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} strokeLinejoin="round">
    <path
      d="M8 1.9l1.85 3.76 4.15.6-3 2.93.71 4.13L8 11.37l-3.71 1.95.71-4.13-3-2.93 4.15-.6z"
      fill={filled ? "currentColor" : "none"}
    />
  </svg>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </svg>
);
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 3.5l7.5 4.5L5 12.5z" />
  </svg>
);
/** Follow. */
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
/** Unfollow. */
export const IconMinus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 8h10" />
  </svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 8.5l3.25 3.25L13 5" />
  </svg>
);
/** A cog with six teeth. */
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeLinejoin="round">
    <path d="M6.49,3.34 L6.72,1.42 L9.28,1.42 L9.51,3.34 L11.28,4.36 L13.06,3.60 L14.33,5.82 L12.79,6.98 L12.79,9.02 L14.33,10.18 L13.06,12.40 L11.28,11.64 L9.51,12.66 L9.28,14.58 L6.72,14.58 L6.49,12.66 L4.72,11.64 L2.94,12.40 L1.67,10.18 L3.21,9.02 L3.21,6.98 L1.67,5.82 L2.94,3.60 L4.72,4.36Z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);
