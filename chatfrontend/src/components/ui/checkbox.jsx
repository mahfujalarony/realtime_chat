import * as React from "react"
import { Check } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-5 shrink-0 rounded-[6px] border border-[#cfd8de] bg-white text-white shadow-sm outline-none transition-all focus-visible:border-[#1aa34a] focus-visible:ring-[3px] focus-visible:ring-[#25d366]/20 data-[state=checked]:border-[#1aa34a] data-[state=checked]:bg-[#25d366] data-[state=checked]:text-white data-[state=checked]:shadow-[0_0_0_1px_rgba(37,211,102,0.18)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <Check className="size-3.5 stroke-[3]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
