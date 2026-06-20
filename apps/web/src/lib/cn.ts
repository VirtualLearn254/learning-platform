import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class merger. The standard shadcn/ui pattern. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
