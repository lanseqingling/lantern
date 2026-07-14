import { useEffect } from "react";

export function useOutsidePointerDismiss(active: boolean, allowedSelector: string, dismiss: () => void, capture = false) {
  useEffect(() => {
    if (!active) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(allowedSelector)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown, capture);
    return () => document.removeEventListener("pointerdown", handlePointerDown, capture);
  }, [active, allowedSelector, capture, dismiss]);
}
