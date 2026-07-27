import type { ReactElement, ReactNode, SVGProps } from "react";
import {
  AtSign,
  ArrowDown,
  ArrowUp,
  BookOpen,
  BookOpenCheck,
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Copy,
  Crop,
  Download,
  FileText,
  FileUp,
  Folder,
  Hand,
  Home,
  History,
  Image,
  Images,
  LayoutGrid,
  Layers3,
  Menu,
  MessageCircle,
  MapPin,
  MoreHorizontal,
  MoreVertical,
  Move,
  MousePointer2,
  Network,
  PanelRightClose,
  PanelsTopLeft,
  Package,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  SendHorizontal,
  Settings,
  Sparkles,
  SquareMousePointer,
  Trash2,
  Type,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };
type IconGlyph = LucideIcon | ((props: IconProps) => ReactElement);

function PageSingleIcon({ size = 16, ...props }: IconProps): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
    <path d="M8.5 8h7M8.5 12h5" />
  </svg>;
}

function PageSpreadIcon({ size = 16, ...props }: IconProps): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3.5 5.75c2.95-.85 5.55-.15 8.5 1.25v12c-2.95-1.4-5.55-2.1-8.5-1.25z" />
    <path d="M20.5 5.75c-2.95-.85-5.55-.15-8.5 1.25v12c2.95-1.4 5.55-2.1 8.5-1.25z" />
    <path d="M7 10h2.5M14.5 10H17" />
  </svg>;
}

function WorkbenchIcon({ size = 16, ...props }: IconProps): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M7 2.5H4a1.5 1.5 0 0 0-1.5 1.5v3M17 2.5h3A1.5 1.5 0 0 1 21.5 4v3M21.5 17v3a1.5 1.5 0 0 1-1.5 1.5h-3M7 21.5H4A1.5 1.5 0 0 1 2.5 20v-3" />
    <path d="M12 5c.55 3.8 3.2 6.45 7 7-3.8.55-6.45 3.2-7 7-.55-3.8-3.2-6.45-7-7 3.8-.55 6.45-3.2 7-7Z" />
  </svg>;
}

const glyphs = {
  select: MousePointer2,
  pan: Hand,
  asset: Images,
  assetAll: LayoutGrid,
  scene: MapPin,
  prop: Package,
  referenceImage: Image,
  home: Home,
  folder: Folder,
  comic: BookOpen,
  workbench: WorkbenchIcon,
  connection: Network,
  layout: LayoutGrid,
  layers: Layers3,
  text: Type,
  ai: Sparkles,
  preview: BookOpenCheck,
  undo: RotateCcw,
  redo: RotateCw,
  more: MoreHorizontal,
  moreVertical: MoreVertical,
  save: Save,
  send: SendHorizontal,
  x: X,
  collapse: ChevronLeft,
  expand: ChevronRight,
  move: Move,
  crop: Crop,
  replace: RefreshCw,
  reference: AtSign,
  edit: Pencil,
  hamburger: Menu,
  download: Download,
  publish: FileUp,
  add: Plus,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  panelRightClose: PanelRightClose,
  storyboard: PanelsTopLeft,
  pages: FileText,
  pageSingle: PageSingleIcon,
  pageSpread: PageSpreadIcon,
  pointer: SquareMousePointer,
  pin: Pin,
  message: MessageCircle,
  trash: Trash2,
  user: UserRound,
  settings: Settings,
  help: CircleHelp,
  history: History,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  scan: Scan,
  context: Braces,
  copy: Copy,
} satisfies Record<string, IconGlyph>;

export type IconName = keyof typeof glyphs;

export function Icon({ name }: { name: IconName }): ReactNode {
  const Glyph = glyphs[name];
  return <Glyph aria-hidden="true" size={16} strokeWidth={2.35} />;
}
