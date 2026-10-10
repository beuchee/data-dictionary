// from linkr@1310cf4a4 apps/web/src/lib/utils.ts (cn only)
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
