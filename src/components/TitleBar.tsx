import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Settings, Square, X } from 'lucide-react'
import { Button } from './ui/button'

const appWindow = '__TAURI_INTERNALS__' in window ? getCurrentWindow() : null

interface TitleBarProps {
  settingsOpen?: boolean
  onSettings?: () => void
}

export function TitleBar({ settingsOpen = false, onSettings }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="relative z-[200] h-9 flex shrink-0 items-center select-none border-b border-sky-hairline bg-sky-canvas-soft"
    >
      <span data-tauri-drag-region className="text-sky-ink font-semibold text-sm px-4">
        SkyEye
      </span>

      <div className="flex-1" data-tauri-drag-region />

      <div className="flex items-center h-full">
        <Button
          variant={settingsOpen ? 'active' : 'ghost'}
          size="icon"
          onClick={onSettings}
          className="h-9 w-10 rounded-none"
          aria-label="设置"
          title="编辑 config/settings.json"
        >
          <Settings size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => appWindow?.minimize()}
          disabled={!appWindow}
          className="h-9 w-10 rounded-none"
          aria-label="最小化"
          title="最小化"
        >
          <Minus size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => appWindow?.toggleMaximize()}
          disabled={!appWindow}
          className="h-9 w-10 rounded-none"
          aria-label="最大化或还原"
          title="最大化"
        >
          <Square size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => appWindow?.close()}
          disabled={!appWindow}
          className="h-9 w-10 rounded-none hover:bg-sky-error hover:text-white"
          aria-label="关闭"
          title="关闭"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  )
}
