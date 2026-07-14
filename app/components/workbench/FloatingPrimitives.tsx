import type { ComponentPropsWithoutRef } from "react";

function classes(base: string, value?: string) {
  return value ? `${base} ${value}` : base;
}

export function FloatingMenu({ className, role = "menu", ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={classes("floating-menu", className)} role={role} {...props} />;
}

export function MenuSection({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={classes("floating-menu-section", className)} {...props} />;
}

export function MenuDivider({ className, ...props }: ComponentPropsWithoutRef<"i">) {
  return <i aria-hidden="true" className={classes("floating-menu-divider", className)} {...props} />;
}
