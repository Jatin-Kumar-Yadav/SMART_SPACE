import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-45 cursor-pointer select-none',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
        secondary: 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 shadow-sm',
        ghost: 'text-slate-700 hover:bg-slate-100',
        active: 'bg-blue-50 text-blue-700 border border-blue-200',
        danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
      },
      size: { default: 'h-8 px-3', sm: 'h-7 px-2 text-xs', icon: 'h-8 w-8', iconSm: 'h-7 w-7' },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
