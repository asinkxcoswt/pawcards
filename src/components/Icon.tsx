import {
  Archive,
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Dices,
  Download,
  Eraser,
  Eye,
  Flag,
  Highlighter,
  Image,
  Lock,
  Minus,
  Pen,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Redo2,
  Settings,
  Share2,
  Smartphone,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'

/**
 * One place for every functional UI icon, so the whole app draws from a single
 * set (currentColor → recolors with the theme) and swapping the set later is a
 * one-file change. Semantic names, not lucide names, so intent stays clear.
 */
const ICONS = {
  back: ChevronLeft,
  backArrow: ArrowLeft,
  settings: Settings,
  share: Share2,
  friends: UsersRound,
  room: UsersRound,
  lock: Lock,
  rename: Pencil,
  delete: Trash2,
  generate: Sparkles,
  caret: ChevronDown,
  next: ChevronRight,
  reveal: Eye,
  finish: Flag,
  undo: Undo2,
  redo: Redo2,
  refresh: RefreshCw,
  close: X,
  export: Download,
  import: Download,
  camera: Camera,
  photo: Image,
  eraser: Eraser,
  pen: Pen,
  highlighter: Highlighter,
  plus: Plus,
  minus: Minus,
  play: Play,
  qr: QrCode,
  dice: Dices,
  cloud: Cloud,
  backup: Archive,
  upload: Upload,
  install: Smartphone,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export default function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 2,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  const C = ICONS[name]
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
}
