import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileCode2,
  Gauge,
  Info,
  MapPinned,
  RefreshCw,
  SlidersHorizontal,
  Telescope,
  X,
} from 'lucide-react'
import type { AppConfig, MpcorbManifest } from '../lib/tauri'
import { Button } from './ui/button'
import { controlClassName, Field, Input, Select } from './ui/form'

interface Props {
  config: AppConfig | null
  mpcorb: MpcorbManifest | null
  mpcorbBusy: boolean
  onClose: () => void
  onSave: (config: AppConfig) => Promise<void>
  onUpdateMpcorb: () => Promise<void>
}

type Tab = 'station' | 'instrument' | 'reduction' | 'photometry' | 'data' | 'about' | 'json'

const tabs: Array<{ id: Tab; label: string; icon: typeof MapPinned }> = [
  { id: 'station', label: '台站与报告', icon: MapPinned },
  { id: 'instrument', label: '仪器与时间', icon: Telescope },
  { id: 'reduction', label: '归算与星点', icon: Gauge },
  { id: 'photometry', label: '光度与输出', icon: SlidersHorizontal },
  { id: 'data', label: '数据管理', icon: Database },
  { id: 'about', label: '关于', icon: Info },
  { id: 'json', label: '高级 JSON', icon: FileCode2 },
]

const referenceBandOptions: Array<{
  value: AppConfig['photometry']['reference_band']
  label: string
  column: string
}> = [
  { value: 'G', label: 'G (Gaia)', column: 'Gmag' },
  { value: 'g', label: 'g (Pan-STARRS)', column: 'gmag' },
  { value: 'r', label: 'r (Pan-STARRS)', column: 'rmag' },
  { value: 'i', label: 'i (Pan-STARRS)', column: 'imag' },
  { value: 'z', label: 'z (Pan-STARRS)', column: 'zmag' },
]

const reportBandOptions = [
  { value: 'C', label: 'Clear / None', system: 'MPC Clear' },
  { value: 'U', label: 'U (Johnson)', system: 'Johnson' },
  { value: 'B', label: 'B (Johnson)', system: 'Johnson' },
  { value: 'V', label: 'V (Johnson)', system: 'Johnson' },
  { value: 'R', label: 'R (Cousins)', system: 'Cousins' },
  { value: 'I', label: 'I (Cousins)', system: 'Cousins' },
  { value: 'u', label: 'u (Sloan)', system: 'Sloan' },
  { value: 'g', label: 'g (Sloan)', system: 'Sloan' },
  { value: 'r', label: 'r (Sloan)', system: 'Sloan' },
  { value: 'i', label: 'i (Sloan)', system: 'Sloan' },
  { value: 'z', label: 'z (Sloan)', system: 'Sloan' },
]

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function listValue(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-sky-hairline bg-sky-canvas-soft px-3 py-2.5 transition-colors hover:border-sky-hairline-strong">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 accent-sky-primary"
      />
      <span>
        <span className="block text-[11px] font-medium text-sky-body">{label}</span>
        {hint && <span className="mt-0.5 block text-[10px] leading-4 text-sky-mute">{hint}</span>}
      </span>
    </label>
  )
}

function updaterErrorMessage(reason: unknown) {
  const message = String(reason)
  const normalized = message.toLowerCase()
  if (
    normalized.includes('endpoint') ||
    normalized.includes('pubkey') ||
    normalized.includes('public key')
  ) {
    return '自动更新尚未配置：需要在发行版中嵌入更新地址和 updater 签名公钥。'
  }
  return `检查更新失败：${message}`
}

export function SettingsDialog({
  config,
  mpcorb,
  mpcorbBusy,
  onClose,
  onSave,
  onUpdateMpcorb,
}: Props) {
  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [tab, setTab] = useState<Tab>('station')
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [appVersion, setAppVersion] = useState('读取中…')
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'current' | 'available' | 'installing' | 'error'
  >('idle')
  const [availableUpdate, setAvailableUpdate] = useState<Awaited<ReturnType<typeof check>>>(null)
  const [updateMessage, setUpdateMessage] = useState('打开本页时自动检查，也可以手动重新检查。')
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [mpcorbError, setMpcorbError] = useState<string | null>(null)
  const checkedUpdate = useRef(false)

  const checkSoftwareUpdate = useCallback(async () => {
    setUpdateStatus('checking')
    setUpdateMessage('正在连接更新服务…')
    setUpdateProgress(null)
    try {
      const update = await check({ timeout: 15_000 })
      setAvailableUpdate(update)
      if (update) {
        setUpdateStatus('available')
        setUpdateMessage(`发现 Sky Eye ${update.version}`)
      } else {
        setUpdateStatus('current')
        setUpdateMessage('当前已经是最新版本。')
      }
    } catch (reason) {
      setAvailableUpdate(null)
      setUpdateStatus('error')
      setUpdateMessage(updaterErrorMessage(reason))
    }
  }, [])

  const installSoftwareUpdate = useCallback(async () => {
    if (!availableUpdate) return
    setUpdateStatus('installing')
    setUpdateMessage(`正在下载 Sky Eye ${availableUpdate.version}…`)
    let downloaded = 0
    let total = 0
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          setUpdateProgress(total > 0 ? Math.min(100, (downloaded / total) * 100) : null)
        } else if (event.event === 'Finished') {
          setUpdateProgress(100)
        }
      })
      setUpdateMessage('更新已安装，正在重新启动…')
      await relaunch()
    } catch (reason) {
      setUpdateStatus('error')
      setUpdateMessage(`安装更新失败：${String(reason)}`)
    }
  }, [availableUpdate])

  const updateMpcorbDatabase = useCallback(async () => {
    setMpcorbError(null)
    try {
      await onUpdateMpcorb()
    } catch (reason) {
      setMpcorbError(String(reason))
    }
  }, [onUpdateMpcorb])

  useEffect(() => {
    if (!config) return
    setDraft(structuredClone(config))
    setJsonText(JSON.stringify(config, null, 2))
  }, [config])

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('未知'))
  }, [])

  useEffect(() => {
    if (tab !== 'about' || checkedUpdate.current) return
    checkedUpdate.current = true
    void checkSoftwareUpdate()
  }, [checkSoftwareUpdate, tab])

  const activeDescription = useMemo(
    () =>
      ({
        station: 'MPC 身份、观测地点和报告署名',
        instrument: '生成 WCS 初值并正确解释 FITS 时间',
        reduction: 'Gaia 匹配、星点筛选和解算质量门限',
        photometry: '将参考星表波段与报告滤镜明确分离',
        data: '本地 MPCORB 更新与覆盖层显示偏好',
        about: '版本信息、更新状态和发行渠道',
        json: '直接查看和编辑 config/settings.json',
      })[tab],
    [tab],
  )

  if (!draft)
    return (
      <div
        className="fixed inset-x-0 bottom-0 top-9 z-[120] grid place-items-center bg-black/55 px-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-loading-title"
      >
        <section className="w-[360px] rounded-lg border border-sky-hairline-strong bg-sky-overlay p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <h2 id="settings-loading-title" className="text-[13px] font-medium text-sky-ink">
              软件设置
            </h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X size={15} />
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-sky-mute">
            配置尚未加载。请关闭后重试；若持续出现，请检查 config/settings.json。
          </p>
        </section>
      </div>
    )

  const selectTab = (next: Tab) => {
    setError(null)
    if (next === 'json') setJsonText(JSON.stringify(draft, null, 2))
    setTab(next)
  }

  const changeJson = (value: string) => {
    setJsonText(value)
    try {
      const parsed = JSON.parse(value) as AppConfig
      setDraft(parsed)
      setError(null)
    } catch (reason) {
      setError(`JSON 格式错误：${String(reason)}`)
    }
  }

  const save = async () => {
    if (tab === 'json') {
      try {
        setDraft(JSON.parse(jsonText) as AppConfig)
      } catch (reason) {
        setError(`JSON 格式错误：${String(reason)}`)
        return
      }
    }
    setError(null)
    setSaving(true)
    try {
      const value = tab === 'json' ? (JSON.parse(jsonText) as AppConfig) : draft
      await onSave(value)
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-9 z-[120] grid place-items-center bg-black/55 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <section className="flex h-[min(760px,calc(100vh-64px))] w-[min(980px,calc(100vw-28px))] overflow-hidden rounded-lg border border-sky-hairline-strong bg-sky-overlay shadow-2xl">
        <aside className="flex w-48 shrink-0 flex-col border-r border-sky-hairline bg-sky-canvas-soft">
          <div className="border-b border-sky-hairline px-4 py-4">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md border border-sky-primary/30 bg-sky-primary/10 text-sky-primary">
              <SlidersHorizontal size={15} />
            </div>
            <h2 id="settings-title" className="text-[13px] font-semibold text-sky-ink">
              软件设置
            </h2>
            <p className="mt-1 font-mono text-[9px] text-sky-mute">
              schema v{draft.schema_version}
            </p>
          </div>
          <nav className="flex-1 space-y-1 p-2" aria-label="设置分类">
            {tabs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => selectTab(item.id)}
                  className={`flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[11px] transition-colors ${tab === item.id ? 'bg-sky-primary text-white' : 'text-sky-body hover:bg-sky-control-hover hover:text-sky-ink'}`}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="border-t border-sky-hairline p-3 text-[9px] leading-4 text-sky-mute">
            保存时校验配置，并原子替换原文件。
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[69px] shrink-0 items-center justify-between border-b border-sky-hairline px-6">
            <div>
              <div className="text-[13px] font-medium text-sky-ink">
                {tabs.find((item) => item.id === tab)?.label}
              </div>
              <p className="mt-1 text-[10px] text-sky-mute">{activeDescription}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭设置">
              <X size={15} />
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === 'station' && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    观测地点
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="MPC 台站代码">
                      <Input
                        className="font-mono uppercase"
                        maxLength={3}
                        value={draft.station.mpc_code}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: { ...draft.station, mpc_code: e.target.value.toUpperCase() },
                          })
                        }
                        placeholder="F51"
                      />
                    </Field>
                    <Field label="台站名称" className="col-span-2">
                      <Input
                        value={draft.station.name}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: { ...draft.station, name: e.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field label="经度 · 东经为正">
                      <Input
                        type="number"
                        step="0.0001"
                        value={draft.station.longitude_deg_east ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: {
                              ...draft.station,
                              longitude_deg_east: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="纬度 · 北纬为正">
                      <Input
                        type="number"
                        step="0.0001"
                        value={draft.station.latitude_deg ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: {
                              ...draft.station,
                              latitude_deg: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="海拔 · m">
                      <Input
                        type="number"
                        value={draft.station.altitude_m ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: {
                              ...draft.station,
                              altitude_m: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                </section>
                <section className="border-t border-sky-hairline pt-5">
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    署名与设备
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="提交者">
                      <Input
                        value={draft.submitter}
                        onChange={(e) => setDraft({ ...draft, submitter: e.target.value })}
                      />
                    </Field>
                    <Field label="探测器">
                      <Input
                        value={draft.station.detector}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: { ...draft.station, detector: e.target.value },
                          })
                        }
                        placeholder="CCD / CMOS"
                      />
                    </Field>
                    <Field label="观测者" hint="多人使用逗号分隔">
                      <Input
                        value={draft.station.observer_names.join(', ')}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: {
                              ...draft.station,
                              observer_names: listValue(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="测量者" hint="多人使用逗号分隔">
                      <Input
                        value={draft.station.measurer_names.join(', ')}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: {
                              ...draft.station,
                              measurer_names: listValue(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="望远镜描述" className="col-span-2">
                      <Input
                        value={draft.station.telescope ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: { ...draft.station, telescope: e.target.value || undefined },
                          })
                        }
                        placeholder="1.8-m f/4.4 Ritchey-Chretien + CCD"
                      />
                    </Field>
                    <Field label="口径 · m">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.station.aperture_m ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: {
                              ...draft.station,
                              aperture_m: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="焦比">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.station.focal_ratio ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            station: {
                              ...draft.station,
                              focal_ratio: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                </section>
              </div>
            )}

            {tab === 'instrument' && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    比例与方向
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="焦距 · mm">
                      <Input
                        type="number"
                        value={draft.instrument.focal_length_mm ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              focal_length_mm: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="焦距容差 · %">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.instrument.focal_length_tolerance_percent}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              focal_length_tolerance_percent: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="指向容差 · arcmin">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.instrument.pointing_tolerance_arcmin}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              pointing_tolerance_arcmin: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="像元宽 · μm">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.instrument.pixel_width_um ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              pixel_width_um: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="像元高 · μm">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.instrument.pixel_height_um ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              pixel_height_um: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="饱和值 · ADU">
                      <Input
                        type="number"
                        value={draft.instrument.saturation_adu ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              saturation_adu: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="默认位置角 · deg">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.instrument.position_angle_deg ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              position_angle_deg: optionalNumber(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="位置角容差 · deg">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.instrument.position_angle_tolerance_deg}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            instrument: {
                              ...draft.instrument,
                              position_angle_tolerance_deg: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Check
                      checked={draft.instrument.flip_horizontal}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          instrument: { ...draft.instrument, flip_horizontal: value },
                        })
                      }
                      label="水平翻转"
                    />
                    <Check
                      checked={draft.instrument.flip_vertical}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          instrument: { ...draft.instrument, flip_vertical: value },
                        })
                      }
                      label="垂直翻转"
                    />
                    <Check
                      checked={draft.instrument.auto_rotate_pierside}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          instrument: { ...draft.instrument, auto_rotate_pierside: value },
                        })
                      }
                      label="读取 PIERSIDE"
                    />
                  </div>
                </section>
                <section className="border-t border-sky-hairline pt-5">
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    FITS 时间
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="DATE-OBS 表示">
                      <Select
                        value={draft.time.date_obs_reference}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            time: {
                              ...draft.time,
                              date_obs_reference: e.target
                                .value as AppConfig['time']['date_obs_reference'],
                            },
                          })
                        }
                      >
                        <option value="start">曝光开始</option>
                        <option value="midpoint">曝光中点</option>
                        <option value="end">曝光结束</option>
                      </Select>
                    </Field>
                    <Field label="曝光时间单位">
                      <Select
                        value={draft.time.exposure_unit}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            time: {
                              ...draft.time,
                              exposure_unit: e.target.value as AppConfig['time']['exposure_unit'],
                            },
                          })
                        }
                      >
                        <option value="seconds">秒</option>
                        <option value="milliseconds">毫秒</option>
                        <option value="minutes">分钟</option>
                      </Select>
                    </Field>
                    <Field label="时间精度 · s">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.time.precision_seconds}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            time: { ...draft.time, precision_seconds: Number(e.target.value) },
                          })
                        }
                      />
                    </Field>
                    <Field label="加到 Header 的 UTC 修正 · h">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.time.utc_offset_hours}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            time: { ...draft.time, utc_offset_hours: Number(e.target.value) },
                          })
                        }
                      />
                    </Field>
                    <Field label="快门延迟 · s">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.time.shutter_delay_seconds}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            time: { ...draft.time, shutter_delay_seconds: Number(e.target.value) },
                          })
                        }
                      />
                    </Field>
                    <Check
                      checked={draft.time.check_after_loading}
                      onChange={(value) =>
                        setDraft({ ...draft, time: { ...draft.time, check_after_loading: value } })
                      }
                      label="加载后检查时间"
                    />
                  </div>
                </section>
              </div>
            )}

            {tab === 'reduction' && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    星点提取
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="检测阈值 · σ">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.reduction.detection_sigma}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              detection_sigma: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="最小 FWHM · px">
                      <Input
                        type="number"
                        step="0.05"
                        value={draft.reduction.minimum_fwhm_px}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              minimum_fwhm_px: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="PSF 拟合 RMS">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.reduction.maximum_psf_fit_rms}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              maximum_psf_fit_rms: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="质心搜索半径 · px">
                      <Input
                        type="number"
                        step="0.05"
                        value={draft.reduction.centroid_search_radius_px}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              centroid_search_radius_px: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="质心方法">
                      <Select
                        value={draft.reduction.centroid_method}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              centroid_method: e.target.value as 'psf' | 'aperture',
                            },
                          })
                        }
                      >
                        <option value="psf">二维 PSF</option>
                        <option value="aperture">孔径质心</option>
                      </Select>
                    </Field>
                  </div>
                </section>
                <section className="border-t border-sky-hairline pt-5">
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    Gaia DR3 匹配
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="天文星表">
                      <Input value="Gaia DR3" disabled />
                    </Field>
                    <Field label="亮端限制 · G">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.reduction.catalog_bright_limit_mag}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              catalog_bright_limit_mag: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="暗端限制 · G">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.reduction.catalog_faint_limit_mag}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              catalog_faint_limit_mag: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="最多参考星">
                      <Input
                        type="number"
                        value={draft.reduction.maximum_reference_stars}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              maximum_reference_stars: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="初始匹配半径 · px">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.reduction.initial_match_radius_px}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              initial_match_radius_px: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="位置残差上限 · arcsec">
                      <Input
                        type="number"
                        step="0.05"
                        value={draft.reduction.astrometric_residual_limit_arcsec}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              astrometric_residual_limit_arcsec: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="WCS 模型">
                      <Select
                        value={draft.reduction.plate_model}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              plate_model: e.target.value as AppConfig['reduction']['plate_model'],
                            },
                          })
                        }
                      >
                        <option value="linear">线性</option>
                        <option value="quadratic">二次</option>
                        <option value="cubic">三次</option>
                      </Select>
                    </Field>
                    <Field label="图像对齐参考星">
                      <Input
                        type="number"
                        value={draft.reduction.alignment_reference_stars}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            reduction: {
                              ...draft.reduction,
                              alignment_reference_stars: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                </section>
              </div>
            )}

            {tab === 'photometry' && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    REFCAT2 定标
                  </h3>
                  <div className="mb-4 rounded-md border border-sky-primary/25 bg-sky-primary/5 px-3 py-2 text-[10px] leading-4 text-sky-body">
                    <b className="text-sky-ink">标准波段与观测滤镜分开记录。</b> ADES 的{' '}
                    <span className="font-mono">band</span> 来自实际定标使用的 REFCAT2 波段；非
                    Clear 滤镜另写入 <span className="font-mono">fltr</span>。
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="光度星表">
                      <Input value="ATLAS REFCAT2" disabled />
                    </Field>
                    <Field
                      label="参考星表波段"
                      hint={`TAP 字段：${referenceBandOptions.find((option) => option.value === draft.photometry.reference_band)?.column}`}
                    >
                      <Select
                        value={draft.photometry.reference_band}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              reference_band: e.target
                                .value as AppConfig['photometry']['reference_band'],
                            },
                          })
                        }
                      >
                        {referenceBandOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="孔径模式">
                      <Select
                        value={draft.photometry.aperture_mode}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              aperture_mode: e.target.value as 'adaptive' | 'fixed',
                            },
                          })
                        }
                      >
                        <option value="adaptive">自适应 FWHM</option>
                        <option value="fixed">固定像素</option>
                      </Select>
                    </Field>
                    <Field label="孔径 · FWHM 倍数">
                      <Input
                        type="number"
                        step="0.1"
                        disabled={draft.photometry.aperture_mode !== 'adaptive'}
                        value={draft.photometry.aperture_fwhm_multiplier}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              aperture_fwhm_multiplier: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="固定孔径 · px">
                      <Input
                        type="number"
                        step="0.1"
                        disabled={draft.photometry.aperture_mode !== 'fixed'}
                        value={draft.photometry.fixed_aperture_radius_px}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              fixed_aperture_radius_px: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="固定孔径间隔 · px">
                      <Input
                        type="number"
                        step="0.1"
                        disabled={draft.photometry.aperture_mode !== 'fixed'}
                        value={draft.photometry.aperture_gap_px}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              aperture_gap_px: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="天光环内径 · FWHM">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.photometry.sky_annulus_inner_fwhm}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              sky_annulus_inner_fwhm: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="天光环外径 · FWHM">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.photometry.sky_annulus_outer_fwhm}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              sky_annulus_outer_fwhm: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="最少参考星">
                      <Input
                        type="number"
                        value={draft.photometry.minimum_reference_stars}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              minimum_reference_stars: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="目录误差上限 · mag">
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.photometry.maximum_catalog_error_mag}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              maximum_catalog_error_mag: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="拟合残差上限 · mag">
                      <Input
                        type="number"
                        step="0.05"
                        value={draft.photometry.maximum_residual_mag}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            photometry: {
                              ...draft.photometry,
                              maximum_residual_mag: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Check
                      checked={draft.photometry.fit_color_term}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          photometry: { ...draft.photometry, fit_color_term: value },
                        })
                      }
                      label="拟合颜色项"
                      hint="可疑目标没有已知颜色时建议关闭"
                    />
                  </div>
                </section>
                <section className="border-t border-sky-hairline pt-5">
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    报告输出
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="默认格式">
                      <Select
                        value={draft.report.default_format}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            report: {
                              ...draft.report,
                              default_format: e.target
                                .value as AppConfig['report']['default_format'],
                            },
                          })
                        }
                      >
                        <option value="ades2022_psv">ADES 2022 PSV</option>
                        <option value="mpc1992_80_column">MPC 80-column</option>
                      </Select>
                    </Field>
                    <Field label="观测滤镜 / fltr">
                      <Select
                        className="font-mono"
                        value={draft.report.band}
                        onChange={(e) =>
                          setDraft({ ...draft, report: { ...draft.report, band: e.target.value } })
                        }
                      >
                        {reportBandOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.value} · {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Check
                      checked={draft.report.include_magnitude}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          report: { ...draft.report, include_magnitude: value },
                        })
                      }
                      label="报告包含星等"
                    />
                    <Check
                      checked={draft.report.position_precision_1e6_deg}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          report: { ...draft.report, position_precision_1e6_deg: value },
                        })
                      }
                      label="位置到 1E-6 deg"
                    />
                    <Check
                      checked={draft.report.magnitude_precision_hundredth}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          report: { ...draft.report, magnitude_precision_hundredth: value },
                        })
                      }
                      label="星等到 0.01 mag"
                    />
                    <Check
                      checked={draft.report.allow_artificial_satellites}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          report: { ...draft.report, allow_artificial_satellites: value },
                        })
                      }
                      label="允许人造卫星"
                    />
                  </div>
                </section>
              </div>
            )}

            {tab === 'data' && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    MPCORB
                  </h3>
                  <div className="mb-3 rounded-md border border-sky-hairline-strong bg-sky-canvas-soft p-4">
                    <div className="flex items-start justify-between gap-5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${mpcorb ? 'bg-sky-success' : 'bg-sky-mute'}`}
                          />
                          <span className="text-[12px] font-medium text-sky-ink">
                            {mpcorb ? '本地轨道数据库可用' : '尚未安装本地轨道数据库'}
                          </span>
                        </div>
                        {mpcorb ? (
                          <div className="mt-2 space-y-1 font-mono text-[9px] leading-4 text-sky-mute">
                            <div>
                              {mpcorb.record_count.toLocaleString()} 条轨道 · 更新于{' '}
                              {new Date(mpcorb.downloaded_unix * 1000).toLocaleString()}
                            </div>
                            <div className="break-all">SHA-256 {mpcorb.sha256}</div>
                            <div>索引格式 {mpcorb.parser_version}</div>
                          </div>
                        ) : (
                          <p className="mt-2 text-[10px] leading-4 text-sky-mute">
                            下载后才能显示已知目标并匹配可疑目标 tracklet。
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void updateMpcorbDatabase()}
                        disabled={mpcorbBusy}
                      >
                        <RefreshCw size={13} className={mpcorbBusy ? 'animate-spin' : ''} />
                        {mpcorbBusy ? '正在处理…' : mpcorb ? '立即更新' : '下载数据库'}
                      </Button>
                    </div>
                    {mpcorbError && (
                      <p className="mt-3 border-t border-sky-hairline pt-2 text-[10px] leading-4 text-sky-error">
                        {mpcorbError}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Check
                      checked={draft.data.mpcorb_auto_update}
                      onChange={(value) =>
                        setDraft({ ...draft, data: { ...draft.data, mpcorb_auto_update: value } })
                      }
                      label="启动时检查更新"
                      hint="每天最多检查一次；失败保留上一有效版本"
                    />
                    <Field label="最大建议年龄 · h">
                      <Input
                        type="number"
                        value={draft.data.mpcorb_max_age_hours}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            data: { ...draft.data, mpcorb_max_age_hours: Number(e.target.value) },
                          })
                        }
                      />
                    </Field>
                  </div>
                </section>
                <section className="border-t border-sky-hairline pt-5">
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                    已知目标覆盖层
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="主带显示极限 · mag">
                      <Input
                        type="number"
                        step="0.5"
                        value={draft.data.known_object_mba_limit_mag}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            data: {
                              ...draft.data,
                              known_object_mba_limit_mag: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="TNO 显示极限 · mag">
                      <Input
                        type="number"
                        step="0.5"
                        value={draft.data.known_object_tno_limit_mag}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            data: {
                              ...draft.data,
                              known_object_tno_limit_mag: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="预测星等偏移">
                      <Input
                        type="number"
                        step="0.1"
                        value={draft.data.known_object_magnitude_offset}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            data: {
                              ...draft.data,
                              known_object_magnitude_offset: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <p className="mt-3 text-[10px] leading-4 text-sky-mute">
                    星等限制只影响覆盖层显示，不参与本地匹配候选的硬过滤。
                  </p>
                </section>
              </div>
            )}

            {tab === 'about' && (
              <div className="space-y-5">
                <section className="overflow-hidden rounded-lg border border-sky-hairline-strong bg-sky-canvas-soft">
                  <div className="relative px-5 py-6">
                    <div className="pointer-events-none absolute -right-14 -top-20 h-44 w-44 rounded-full border border-sky-primary/20 bg-sky-primary/5" />
                    <div className="relative flex items-start gap-4">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-sky-primary/35 bg-sky-primary/10 font-mono text-[15px] font-semibold tracking-[0.14em] text-sky-primary">
                        SE
                      </div>
                      <div>
                        <h3 className="text-[18px] font-semibold tracking-tight text-sky-ink">
                          Sky Eye
                        </h3>
                        <p className="mt-1 text-[10px] leading-4 text-sky-mute">
                          面向小行星搜索、测量与 MPC 报告的桌面图像处理工具
                        </p>
                        <div className="mt-3 inline-flex rounded border border-sky-hairline-strong bg-sky-canvas px-2 py-1 font-mono text-[10px] text-sky-body">
                          version {appVersion}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-primary">
                        软件更新
                      </h3>
                      <p className="mt-1 text-[9px] text-sky-mute">打开本页时自动检查发行版</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void checkSoftwareUpdate()}
                      disabled={updateStatus === 'checking' || updateStatus === 'installing'}
                    >
                      <RefreshCw
                        size={13}
                        className={updateStatus === 'checking' ? 'animate-spin' : ''}
                      />
                      重新检查
                    </Button>
                  </div>
                  <div className="rounded-md border border-sky-hairline-strong bg-sky-canvas p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
                          updateStatus === 'error'
                            ? 'border-sky-error/40 bg-sky-error/10 text-sky-error'
                            : updateStatus === 'available'
                              ? 'border-sky-primary/40 bg-sky-primary/10 text-sky-primary'
                              : 'border-sky-hairline-strong bg-sky-canvas-soft text-sky-success'
                        }`}
                      >
                        {updateStatus === 'error' ? (
                          <AlertTriangle size={13} />
                        ) : updateStatus === 'available' || updateStatus === 'installing' ? (
                          <Download size={13} />
                        ) : (
                          <CheckCircle2 size={13} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] leading-5 text-sky-body">{updateMessage}</div>
                        {availableUpdate?.body && (
                          <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap border-t border-sky-hairline pt-2 text-[9px] leading-4 text-sky-mute">
                            {availableUpdate.body}
                          </div>
                        )}
                        {updateStatus === 'installing' && (
                          <div className="mt-3 h-1 overflow-hidden rounded-full bg-sky-hairline">
                            <div
                              className={`h-full bg-sky-primary transition-[width] ${updateProgress == null ? 'w-1/3 animate-pulse' : ''}`}
                              style={
                                updateProgress == null ? undefined : { width: `${updateProgress}%` }
                              }
                            />
                          </div>
                        )}
                      </div>
                      {updateStatus === 'available' && (
                        <Button size="sm" onClick={() => void installSoftwareUpdate()}>
                          下载并安装
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-[9px] leading-4 text-sky-mute">
                    更新包必须通过 Tauri updater 签名校验；安装完成后应用会自动重新启动。
                  </p>
                </section>
              </div>
            )}

            {tab === 'json' && (
              <div className="flex h-full min-h-[480px] flex-col">
                <textarea
                  value={jsonText}
                  onChange={(e) => changeJson(e.target.value)}
                  spellCheck={false}
                  className={`${controlClassName} min-h-0 flex-1 resize-none px-4 py-3 font-mono text-[11px] leading-5`}
                />
                <p className="mt-2 text-[9px] text-sky-mute">
                  有效 JSON 会立即同步到表单；服务端保存时还会执行范围和枚举校验。
                </p>
              </div>
            )}
          </div>

          <footer className="shrink-0 border-t border-sky-hairline bg-sky-canvas-soft px-6 py-3">
            {error && <p className="mb-2 text-[10px] leading-4 text-sky-error">{error}</p>}
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-[9px] text-sky-mute">config/settings.json</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => config && setDraft(structuredClone(config))}
                  disabled={!config || saving}
                >
                  恢复已保存内容
                </Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving || !!error}>
                  {saving ? '保存中…' : '保存设置'}
                </Button>
              </div>
            </div>
          </footer>
        </div>
      </section>
    </div>
  )
}
