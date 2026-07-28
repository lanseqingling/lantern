import type { ReactElement } from "react";
import type { IconGlyphProps } from "./types";

function IconCanvas({ size = 16, children, ...props }: IconGlyphProps & { children: ReactElement | ReactElement[] }): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>;
}

export function PageSingleIcon({ size = 16, ...props }: IconGlyphProps): ReactElement {
  return <IconCanvas size={size} {...props}>
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
    <path d="M8.5 8h7M8.5 12h5" />
  </IconCanvas>;
}

export function PageSpreadIcon({ size = 16, ...props }: IconGlyphProps): ReactElement {
  return <IconCanvas size={size} {...props}>
    <path d="M3.5 5.75c2.95-.85 5.55-.15 8.5 1.25v12c-2.95-1.4-5.55-2.1-8.5-1.25z" />
    <path d="M20.5 5.75c-2.95-.85-5.55-.15-8.5 1.25v12c2.95-1.4 5.55-2.1 8.5-1.25z" />
    <path d="M7 10h2.5M14.5 10H17" />
  </IconCanvas>;
}

export function WorkbenchIcon({ size = 16, ...props }: IconGlyphProps): ReactElement {
  return <IconCanvas size={size} {...props}>
    <path d="M7 2.5H4a1.5 1.5 0 0 0-1.5 1.5v3M17 2.5h3A1.5 1.5 0 0 1 21.5 4v3M21.5 17v3a1.5 1.5 0 0 1-1.5 1.5h-3M7 21.5H4A1.5 1.5 0 0 1 2.5 20v-3" />
    <path d="M12 5c.55 3.8 3.2 6.45 7 7-3.8.55-6.45 3.2-7 7-.55-3.8-3.2-6.45-7-7 3.8-.55 6.45-3.2 7-7Z" />
  </IconCanvas>;
}

export function WorkbenchCompactIcon({ size = 16, ...props }: IconGlyphProps): ReactElement {
  return <IconCanvas size={size} {...props}>
    <path d="M7 3H4a1 1 0 0 0-1 1v3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
    <path d="M12 6c.45 3.1 2.9 5.55 6 6-3.1.45-5.55 2.9-6 6-.45-3.1-2.9-5.55-6-6 3.1-.45 5.55-2.9 6-6Z" />
  </IconCanvas>;
}

export function ComicFormatPageIcon({ size = 16, ...props }: IconGlyphProps): ReactElement {
  return <IconCanvas size={size} {...props}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M3 10h18M11 10v11M8 3v7" />
  </IconCanvas>;
}

export function ComicFormatVerticalIcon({ size = 16, ...props }: IconGlyphProps): ReactElement {
  return <IconCanvas size={size} {...props}>
    <rect x="7" y="2.5" width="10" height="19" rx="3" />
    <path d="M7 8.5h10M7 15h10" />
  </IconCanvas>;
}

export function ComicFormatFourPanelIcon({ size = 16, ...props }: IconGlyphProps): ReactElement {
  return <IconCanvas size={size} {...props}>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M4 12h16M12 3v18" />
  </IconCanvas>;
}
