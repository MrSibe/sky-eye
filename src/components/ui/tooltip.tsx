import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils'
import { Button } from './button'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[300] max-w-64 rounded-md border border-sky-hairline-strong bg-sky-control px-2 py-1 text-label text-sky-ink',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

interface IconButtonProps extends Omit<React.ComponentProps<typeof Button>, 'size' | 'aria-label'> {
  /** 可访问名称，同时用作默认 tooltip 文案（design.md：纯图标按钮必须有 aria-label） */
  label: string
  /** 覆盖 tooltip 内容，用于动态文案（禁用原因、计数等） */
  tooltip?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, tooltip, side = 'top', className, onMouseDown, ...props }, ref) => {
    return (
      <Tooltip>
        {/* span 包裹：Button 自带 disabled:pointer-events-none，禁用态下 pointer 事件被吃掉，
            包裹一层 span 作为触发器，让禁用按钮的 hover 提示仍能弹出 */}
        <TooltipTrigger asChild>
          <span tabIndex={-1} className="inline-flex">
            <Button
              ref={ref}
              size="icon"
              aria-label={label}
              className={className}
              onMouseDown={(event) => {
                // 鼠标点击不保留焦点：避免后续空格/方向键被按钮原生行为劫持（快捷键失效）
                event.preventDefault()
                onMouseDown?.(event)
              }}
              {...props}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
      </Tooltip>
    )
  },
)
IconButton.displayName = 'IconButton'

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, IconButton }
