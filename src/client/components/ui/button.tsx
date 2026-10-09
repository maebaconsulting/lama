import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-sans text-sm font-medium tracking-[0.04em] transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/85",
        // Commande destructive au repos : au trait rouge ; l'aplat est réservé au bouton qui confirme.
        "trait-rouge": "border border-encre-rouge bg-transparent text-encre-rouge hover:bg-accent",
        outline: "border border-input bg-transparent text-foreground hover:bg-accent",
        secondary: "border border-filet bg-card text-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        link: "text-foreground underline decoration-filet underline-offset-4 hover:decoration-foreground",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-11 px-3 text-xs",
        lg: "h-12 px-8",
        icon: "h-11 w-11 shrink-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // Slot (Radix) rend son enfant avec les mêmes propriétés qu'un bouton : un seul type pour tsc.
    const Comp = (asChild ? Slot : "button") as "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
