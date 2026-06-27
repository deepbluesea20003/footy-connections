import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "subtle";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-turf/60";

const variants: Record<Variant, string> = {
  primary: "btn-primary",
  ghost:
    "border border-pitch-border bg-pitch-light/60 text-kit-gray hover:text-kit-white hover:border-turf/50 disabled:opacity-40",
  subtle:
    "text-kit-gray hover:text-kit-white hover:bg-pitch-lighter/60 disabled:opacity-40",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-sm",
};

export function Button({ variant = "primary", size = "md", className = "", ...rest }: Props) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />;
}
