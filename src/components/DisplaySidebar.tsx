import { useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Contrast, Maximize2, Play, Square } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useSessionStore } from '../stores/sessionStore'
import { blinkNext, blinkPrev, blinkSetFrame, blinkSetSpeed } from '../lib/tauri'
import { Button } from './ui/button'
import { Select } from './ui/form'
import { Panel } from './ui/surface'
import { IconButton } from './ui/tooltip'

interface DisplaySidebarProps {
  stretchMode: 'linear' | 'asinh'
  onStretchModeChange: (mode: 'linear' | 'asinh') => void
  inverted: boolean
  onInvertedChange: (inverted: boolean) => void
  onFitView: () => void
}

export function DisplaySidebar({
  stretchMode,
  onStretchModeChange,
  inverted,
  onInvertedChange,
  onFitView,
}: DisplaySidebarProps) {
  // 精确订阅:currentFrameIndex 每 tick 变化仅刷新本栏,不触发无关字段更新
  const {
    frames,
    currentFrameIndex,
    speedMs,
    isPlaying,
    blinkPrep,
    frameAnalyses,
    blinkAlignment,
  } = useSessionStore(
    useShallow((s) => ({
      frames: s.frames,
      currentFrameIndex: s.currentFrameIndex,
      speedMs: s.speedMs,
      isPlaying: s.isPlaying,
      blinkPrep: s.blinkPrep,
      frameAnalyses: s.frameAnalyses,
      blinkAlignment: s.blinkAlignment,
    })),
  )
  const canAlign =
    frames.length >= 2 &&
    frames.every((_, index) => frameAnalyses[index]?.solution?.status === 'accepted')

  const selectFrame = useCallback(async (index: number) => {
    if (useSessionStore.getState().isPlaying) return // 播放中忽略手动切帧
    try {
      useSessionStore.getState().setBlinkState(await blinkSetFrame(index))
    } catch {
      /* ignore transient native errors */
    }
  }, [])

  const changeFrame = useCallback(async (direction: 'previous' | 'next') => {
    if (useSessionStore.getState().isPlaying) return // 播放中忽略手动切帧
    try {
      const state = useSessionStore.getState()
      state.setBlinkState(direction === 'previous' ? await blinkPrev() : await blinkNext())
    } catch {
      /* ignore transient native errors */
    }
  }, [])

  // 播放/暂停完全由前端本地驱动(播放索引在 App 侧 rAF 循环),不再经过 blinkToggle IPC
  const toggleBlink = useCallback(() => {
    const state = useSessionStore.getState()
    state.setPlaying(!state.isPlaying)
  }, [])

  const setSpeed = useCallback((value: number) => {
    const bounded = Math.min(1000, Math.max(50, value))
    useSessionStore.getState().setSpeedMs(bounded)
    void blinkSetSpeed(bounded).catch(() => {
      /* ignore transient native errors */
    })
  }, [])

  const changeSpeed = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSpeed(Number(event.target.value))
    },
    [setSpeed],
  )

  useEffect(() => {
    if (frames.length < 2) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      // 模态弹窗打开或焦点在表单控件（输入/选择/滑杆/富文本）上时，按键交给控件自身处理
      if (
        document.querySelector('[aria-modal="true"]') ||
        (target instanceof HTMLElement &&
          target.closest(
            'input, select, textarea, [contenteditable]:not([contenteditable="false"])',
          ))
      ) {
        return
      }

      // 焦点落在普通按钮上时：空格保留给按钮激活（键盘无障碍），仅方向键仍作为快捷键，
      // 防止按钮残留焦点时方向键触发浏览器原生焦点移动
      if (event.code === 'Space' && target instanceof HTMLElement && target.closest('button')) {
        return
      }

      if (event.code === 'Space') {
        if (event.repeat) return
        event.preventDefault()
        toggleBlink()
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        void changeFrame(event.key === 'ArrowLeft' ? 'previous' : 'next')
        return
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const currentSpeed = useSessionStore.getState().speedMs
        setSpeed(currentSpeed + (event.key === 'ArrowUp' ? -50 : 50))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeFrame, frames.length, setSpeed, toggleBlink])

  return (
    <Panel
      className="w-60 shrink-0 border-l border-sky-hairline"
      title={<span className="text-label tracking-wide">显示</span>}
      aria-label="显示与帧控制"
    >
      <section className="border-b border-sky-hairline px-3 py-3">
        <label
          htmlFor="display-stretch"
          className="mb-1.5 block text-label uppercase tracking-[0.12em] text-sky-mute"
        >
          图像拉伸
        </label>
        <Select
          id="display-stretch"
          value={stretchMode}
          onChange={(event) => onStretchModeChange(event.target.value as 'linear' | 'asinh')}
          className="h-7 text-label"
        >
          <option value="linear">ZScale · 线性</option>
          <option value="asinh">ZScale · Asinh</option>
        </Select>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <IconButton
            variant="ghost"
            className="w-full"
            onClick={onFitView}
            label="适应窗口"
            tooltip="居中图像并缩放到适合当前窗口"
          >
            <Maximize2 size={13} />
          </IconButton>
          <IconButton
            variant={inverted ? 'tool' : 'ghost'}
            className="w-full"
            onClick={() => onInvertedChange(!inverted)}
            aria-pressed={inverted}
            label="反色"
            tooltip={inverted ? '切换为亮星暗背景' : '切换为暗星亮背景'}
          >
            <Contrast size={13} />
          </IconButton>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-sky-hairline px-3">
          <span className="text-label uppercase tracking-[0.12em] text-sky-mute">FITS 列表</span>
          <span className="text-caption-mono text-sky-mute">{frames.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {frames.map((frame, index) => (
            <button
              key={frame.path || index}
              onClick={() => selectFrame(index)}
              aria-current={index === currentFrameIndex ? 'true' : undefined}
              className={`w-full border-b border-sky-hairline px-3 py-2 text-left text-label transition-colors ${
                index === currentFrameIndex
                  ? 'bg-sky-selection text-sky-ink'
                  : 'text-sky-body hover:bg-sky-control-hover hover:text-sky-ink'
              }`}
            >
              <div className="truncate font-normal text-sky-ink/90">{frame.label}</div>
              <div className="mt-0.5 flex items-center justify-between text-caption-mono text-sky-mute">
                <span>
                  {frame.width}×{frame.height}
                </span>
                {frame.solved && <span className="font-sans text-sky-success">已归算</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      {frames.length >= 2 && (
        <section className="shrink-0 border-t border-sky-hairline px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-label uppercase tracking-[0.12em] text-sky-mute">闪烁控制</span>
            <span className="text-caption-mono text-sky-body">
              {currentFrameIndex + 1}/{frames.length}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => changeFrame('previous')}
              onMouseDown={(event) => event.preventDefault()}
              disabled={isPlaying}
              aria-label="上一帧"
              title={isPlaying ? '播放中无法切帧' : '上一帧'}
            >
              <ChevronLeft size={15} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleBlink}
              onMouseDown={(event) => event.preventDefault()}
              disabled={blinkPrep != null}
              aria-label={isPlaying ? '停止闪烁' : '开始闪烁'}
              title={
                blinkPrep != null
                  ? `闪图准备中 ${blinkPrep.loaded}/${blinkPrep.total}`
                  : isPlaying
                    ? '停止'
                    : '开始'
              }
            >
              {blinkPrep != null ? (
                <span className="text-caption-mono">
                  {blinkPrep.loaded}/{blinkPrep.total}
                </span>
              ) : isPlaying ? (
                <Square size={13} />
              ) : (
                <Play size={14} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => changeFrame('next')}
              onMouseDown={(event) => event.preventDefault()}
              disabled={isPlaying}
              aria-label="下一帧"
              title={isPlaying ? '播放中无法切帧' : '下一帧'}
            >
              <ChevronRight size={15} />
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
            <label htmlFor="blink-speed" className="sr-only">
              闪烁速度
            </label>
            <input
              id="blink-speed"
              type="range"
              min={50}
              max={1000}
              step={50}
              value={speedMs}
              onChange={changeSpeed}
              className="h-1 w-full accent-sky-primary"
            />
            <span className="w-12 text-right text-caption-mono text-sky-mute">{speedMs} ms</span>
          </div>

          <div className="mt-3">
            <label htmlFor="blink-alignment" className="mb-1 block text-caption-mono text-sky-mute">
              对齐方式
            </label>
            <Select
              id="blink-alignment"
              value={blinkAlignment}
              disabled={isPlaying}
              onChange={(event) => {
                const mode = event.target.value as 'raw' | 'wcs'
                if (mode === 'wcs' && !canAlign) return
                useSessionStore.getState().setBlinkAlignment(mode, currentFrameIndex)
              }}
              title={!canAlign ? '整组图片完成并接受 WCS 归算后可用' : undefined}
            >
              <option value="raw">原始像素</option>
              <option value="wcs" disabled={!canAlign}>
                WCS 参考星对齐
              </option>
            </Select>
          </div>

          <div className="mt-3 border-t border-sky-hairline pt-2 text-caption-mono text-sky-mute">
            <div className="flex items-center justify-between">
              <span>
                <kbd className="text-sky-body">Space</kbd> 播放 / 暂停
              </span>
              <span>
                <kbd className="text-sky-body">← →</kbd> 切帧
              </span>
            </div>
            <div>
              <kbd className="text-sky-body">↑ ↓</kbd> 加快 / 减慢
            </div>
          </div>
        </section>
      )}
    </Panel>
  )
}
