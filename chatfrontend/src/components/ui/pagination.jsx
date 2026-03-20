import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Pagination({ className, ...props }) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }) {
  return <ul className={cn("flex flex-wrap items-center gap-1", className)} {...props} />
}

function PaginationItem(props) {
  return <li {...props} />
}

function PaginationLink({ className, isActive, size = "icon-sm", ...props }) {
  return (
    <Button
      aria-current={isActive ? "page" : undefined}
      variant={isActive ? "default" : "outline"}
      size={size}
      className={cn(isActive ? "bg-[#25d366] text-white hover:bg-[#22c55e]" : "", className)}
      {...props}
    />
  )
}

function PaginationPrevious({ className, text = "Previous", ...props }) {
  return (
    <PaginationLink aria-label="Go to previous page" size="default" className={cn("gap-1 px-3 sm:pl-2.5", className)} {...props}>
      <ChevronLeft className="size-4" />
      <span className="hidden sm:block">{text}</span>
    </PaginationLink>
  )
}

function PaginationNext({ className, text = "Next", ...props }) {
  return (
    <PaginationLink aria-label="Go to next page" size="default" className={cn("gap-1 px-3 sm:pr-2.5", className)} {...props}>
      <span className="hidden sm:block">{text}</span>
      <ChevronRight className="size-4" />
    </PaginationLink>
  )
}

function PaginationEllipsis({ className, ...props }) {
  return (
    <span aria-hidden className={cn("flex h-9 w-9 items-center justify-center", className)} {...props}>
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
