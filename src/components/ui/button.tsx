import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-primary disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-sky-primary text-sky-on-primary hover:bg-sky-primary-hover',
        secondary:
          'bg-sky-control text-sky-ink border border-sky-hairline-strong hover:bg-sky-control-hover',
        ghost: 'text-sky-body hover:text-sky-ink hover:bg-sky-control-hover',
        tool: 'text-sky-body hover:text-sky-ink hover:bg-sky-control-hover',
        active: 'bg-sky-primary text-sky-on-primary',
      },
      size: {
        sm: 'h-7 px-2 text-button',
        md: 'h-8 px-3 text-button',
        lg: 'h-10 px-4 text-button',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
