import { forwardRef, type ComponentPropsWithoutRef } from "react";

function classes(base: string, value?: string) {
  return value ? `${base} ${value}` : base;
}

export function WorkbenchShell({ className, ...props }: ComponentPropsWithoutRef<"main">) {
  return <main className={classes("workbench", className)} {...props} />;
}

export function CreationDrawer({ className, ...props }: ComponentPropsWithoutRef<"aside">) {
  return <aside className={classes("creation-drawer", className)} {...props} />;
}

export const CanvasStage = forwardRef<HTMLElement, ComponentPropsWithoutRef<"section">>(function CanvasStage({ className, ...props }, ref) {
  return <section ref={ref} className={classes("canvas-stage", className)} {...props} />;
});

export function ObjectToolbar({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={classes("object-toolbar", className)} {...props} />;
}

export function AgentWorkspace({ className, ...props }: ComponentPropsWithoutRef<"aside">) {
  return <aside className={classes("agent-workspace", className)} {...props} />;
}

export function SessionDrawer({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return <section className={classes("canvas-session-drawer", className)} {...props} />;
}

export function CreationDock({ className, ...props }: ComponentPropsWithoutRef<"nav">) {
  return <nav className={classes("creation-dock", className)} {...props} />;
}
