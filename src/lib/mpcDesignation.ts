export function validateTrackletDesignation(input: string): string | null {
  const value = input.trim()
  if (!value) return '请填写可疑目标名称（MPC trkSub）'
  if (value.length > 7) return 'MPC trkSub 最多 7 个字符'
  if (!/^[A-Za-z0-9]+$/.test(value)) return '只能使用 ASCII 字母和数字，不能包含空格或符号'

  const upper = value.toUpperCase()
  const isMpcDesignation =
    /^\d+$/.test(upper) ||
    /^[A-Z0-9]\d{4}$/.test(upper) ||
    /^[I-L]\d{2}[A-Z][A-Z0-9]\d[A-Z]$/.test(upper) ||
    /^\d{4}[A-Z]{2}\d?$/.test(upper)
  if (isMpcDesignation) return '不能使用或仿照 MPC 的永久编号、临时编号或 packed designation'
  return null
}
