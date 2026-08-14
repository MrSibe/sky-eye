import { useEffect, useState } from 'react'
import { ListChecks, Trash2, X } from 'lucide-react'
import type { TargetMeasurement } from '../lib/tauri'
import { validateTrackletDesignation } from '../lib/mpcDesignation'
import { Button } from './ui/button'
import { openUrl } from '@tauri-apps/plugin-opener'

interface Props {
  measurements: TargetMeasurement[]
  canMatch: boolean
  busy: boolean
  onClose: () => void
  onMatch: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}

export function SciencePanel(p: Props) {
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setNames((current) =>
      Object.fromEntries(
        p.measurements.map((measurement) => [
          measurement.id,
          current[measurement.id] ?? measurement.designation,
        ]),
      ),
    )
  }, [p.measurements])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="science-panel-title"
        className="flex h-[min(680px,calc(100vh-2rem))] w-[min(940px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-sky-hairline bg-sky-canvas-soft"
      >
        <header className="flex items-center justify-between border-b border-sky-hairline px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border border-sky-hairline bg-sky-canvas text-sky-body">
              <ListChecks size={17} />
            </div>
            <div className="min-w-0">
              <div id="science-panel-title" className="text-sm font-medium text-sky-ink">
                可疑目标列表
              </div>
              <div className="mt-0.5 text-[10px] text-sky-mute">
                {p.measurements.length} 个测量 · 坐标来自已接受的 WCS 与目标质心
              </div>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={p.onClose}
            onMouseDown={(event) => event.preventDefault()}
            aria-label="关闭可疑目标列表"
          >
            <X size={16} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[11px]">
          {p.measurements.length === 0 ? (
            <div className="grid h-full min-h-52 place-items-center rounded-md border border-dashed border-sky-hairline-strong bg-sky-canvas-soft/30 px-6 text-center">
              <div>
                <div className="text-sm text-sky-body">还没有可疑目标</div>
                <div className="mt-2 max-w-md text-[11px] leading-5 text-sky-mute">
                  关闭窗口后点击工具栏“标记可疑目标”，在已归算图像上点击目标并填写符合 MPC trkSub
                  规则的临时名称。
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-sky-hairline">
              <div className="grid grid-cols-[168px_110px_minmax(190px,1fr)_minmax(150px,0.8fr)_40px] gap-3 border-b border-sky-hairline bg-sky-canvas-soft px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-sky-mute">
                <span>目标名称</span>
                <span>测量</span>
                <span>天球坐标</span>
                <span>质量标记</span>
                <span />
              </div>
              {p.measurements.map((measurement) => {
                const name = names[measurement.id] ?? measurement.designation
                const nameError = validateTrackletDesignation(name)
                return (
                  <div
                    key={measurement.id}
                    className="grid grid-cols-[168px_110px_minmax(190px,1fr)_minmax(150px,0.8fr)_40px] items-start gap-3 border-b border-sky-hairline px-3 py-3 last:border-b-0 hover:bg-sky-control-hover/40"
                  >
                    <div>
                      <input
                        required
                        maxLength={7}
                        value={name}
                        onChange={(event) =>
                          setNames((current) => ({
                            ...current,
                            [measurement.id]: event.target.value,
                          }))
                        }
                        onBlur={(event) => {
                          const value = event.target.value.trim()
                          if (
                            !validateTrackletDesignation(value) &&
                            value !== measurement.designation
                          )
                            p.onRename(measurement.id, value)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        }}
                        aria-invalid={Boolean(nameError)}
                        aria-label={`帧 ${measurement.frame_index + 1} 可疑目标名称`}
                        className={`h-8 w-full rounded border bg-sky-canvas px-2 font-mono text-[11px] text-sky-ink outline-none ${nameError ? 'border-sky-error' : 'border-sky-hairline-strong focus:border-sky-primary'}`}
                      />
                      {nameError && (
                        <div className="mt-1 text-[9px] leading-4 text-sky-error">{nameError}</div>
                      )}
                    </div>
                    <div className="leading-5 text-sky-body">
                      <div>帧 {measurement.frame_index + 1}</div>
                      <div className="text-sky-mute">SNR {measurement.snr?.toFixed(1) ?? '—'}</div>
                      <div className="text-sky-mute">
                        {measurement.magnitude != null
                          ? `${measurement.magnitude.toFixed(2)} ${measurement.band ?? ''}`
                          : '仅 flux'}
                      </div>
                    </div>
                    <div className="font-mono text-[10px] leading-5 text-sky-body">
                      <div>RA&nbsp; {measurement.ra_deg?.toFixed(7) ?? '—'}</div>
                      <div>Dec {measurement.dec_deg?.toFixed(7) ?? '—'}</div>
                    </div>
                    <div className="break-words font-mono text-[9px] leading-5 text-sky-mute">
                      {measurement.flags.join(', ') || 'clean'}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => p.onDelete(measurement.id)}
                      onMouseDown={(event) => event.preventDefault()}
                      disabled={p.busy}
                      aria-label="删除可疑目标"
                      title="删除可疑目标"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-sky-hairline bg-sky-canvas-soft px-5 py-3">
          <div className="text-[10px] text-sky-mute">
            {!p.canMatch && '如需轨迹匹配，请先在“设置 > 数据管理”下载 MPCORB。'}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openUrl('https://minorplanetcenter.net/cgi-bin/checkmp.cgi')}
              onMouseDown={(event) => event.preventDefault()}
              disabled={p.busy || p.measurements.length === 0}
            >
              MPC MPChecker
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={p.onMatch}
              onMouseDown={(event) => event.preventDefault()}
              disabled={p.busy || !p.canMatch || p.measurements.length < 2}
            >
              匹配 tracklet
            </Button>
            <Button size="sm" onClick={p.onClose} onMouseDown={(event) => event.preventDefault()}>
              完成
            </Button>
          </div>
        </footer>
      </section>
    </div>
  )
}
