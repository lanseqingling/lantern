"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ReferencePlacement } from "@lantern/shared";
import { Icon } from "@lantern/ui";
import { assetKindLabel, assetKindTag } from "@/app/lib/asset-kind";
import { FloatingMenu, MenuDivider, MenuSection } from "./FloatingPrimitives";
import { uiCopy } from "@/app/lib/ui-copy";

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function overlapArea(a: DOMRect | { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

export function ReferenceCard({
  reference,
  selected,
  multiSelected,
  multiMode,
  multiMoving,
  multiMoveDelta,
  onSelect,
  onMove,
  onZoom,
  onReference,
  onSaveToAssets,
  onOpenContextMenu,
  assetSaved,
  onDelete,
  onLayer,
  onCycleImage,
  onView,
}: {
  reference: ReferencePlacement;
  selected: boolean;
  multiSelected?: boolean;
  multiMode?: boolean;
  multiMoving?: boolean;
  multiMoveDelta?: { x: number; y: number };
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onZoom: (zoom: number) => void;
  onReference: () => void;
  onSaveToAssets: (anchor: { left: number; right: number; top: number; bottom: number }) => void;
  onOpenContextMenu: () => void;
  assetSaved: boolean;
  onDelete: () => void;
  onLayer: (action: "up" | "down" | "top" | "bottom") => void;
  onCycleImage: () => void;
  onView: () => void;
}) {
  const zoom = reference.zoom ?? 1;
  const isUploadedReference = reference.kind === "reference_image" || reference.localAssetSource === "upload";
  const kindGlyph = assetKindTag(reference.kind);
  const kindName = assetKindLabel(reference.kind);
  const [referenceBaseWidth, setReferenceBaseWidth] = useState(204);
  const [position, setPosition] = useState({ x: reference.x, y: reference.y });
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number; layerMenu?: { left: number; top: number } } | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ originX: number; originY: number; startX: number; startY: number; latestX: number; latestY: number; moved: boolean; viewEligible: boolean } | null>(null);
  const lastViewClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const lastWheelAtRef = useRef(0);
  const zoomRef = useRef(zoom);
  const onZoomRef = useRef(onZoom);

  useEffect(() => {
    const timer = window.setTimeout(() => setPosition({ x: reference.x, y: reference.y }), 0);
    return () => window.clearTimeout(timer);
  }, [reference.x, reference.y]);
  useEffect(() => {
    const updateBaseWidth = () => setReferenceBaseWidth(window.innerWidth >= 1540 ? 220 : window.innerWidth <= 1360 ? 176 : 204);
    updateBaseWidth();
    window.addEventListener("resize", updateBaseWidth);
    return () => window.removeEventListener("resize", updateBaseWidth);
  }, []);
  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".reference-card, .reference-context-menu")) return;
      setContextMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeMenu, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", closeMenu, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);
  useEffect(() => {
    const closeWhenAnotherReferenceOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== reference.id) setContextMenu(null);
    };
    window.addEventListener("lantern-reference-context-open", closeWhenAnotherReferenceOpens);
    return () => window.removeEventListener("lantern-reference-context-open", closeWhenAnotherReferenceOpens);
  }, [reference.id]);
  useEffect(() => { zoomRef.current = zoom; onZoomRef.current = onZoom; }, [zoom, onZoom]);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (now - lastWheelAtRef.current < 110) return;
      lastWheelAtRef.current = now;
      const direction = event.deltaY < 0 ? 1 : -1;
      const next = clampValue(Math.round((zoomRef.current + direction * 0.15) * 20) / 20, 0.2, 4);
      zoomRef.current = next;
      onZoomRef.current(next);
    };
    card.addEventListener("wheel", handleWheel, { passive: false });
    return () => card.removeEventListener("wheel", handleWheel);
  }, []);

  const updateZoom = (nextZoom: number) => {
    const next = clampValue(Math.round(nextZoom * 20) / 20, 0.2, 4);
    zoomRef.current = next;
    onZoom(next);
    setContextMenu(null);
  };
  return (
    <article
      className={`reference-card ${selected ? "selected" : ""} ${multiSelected ? "multi-selected" : ""} ${multiMoving ? "multi-moving" : ""} ${contextMenu ? "menu-open" : ""}`}
      ref={cardRef}
      style={{
        left: position.x,
        top: position.y,
        // Canvas references always sit above the comic page. Opening a context
        // menu temporarily raises the whole card so its menu cannot hide behind
        // another reference or the comic itself.
        zIndex: contextMenu ? 300 : 20 + (reference.zIndex ?? 10),
        "--reference-base-width": `${referenceBaseWidth}px`,
        "--reference-visual-width": `${referenceBaseWidth * zoom}px`,
        "--reference-inset": `${6 / zoom}px`,
        "--reference-zoom": zoom,
        "--reference-ui-scale": 1 / zoom,
        "--multi-move-x": `${multiMoveDelta?.x ?? 0}px`,
        "--multi-move-y": `${multiMoveDelta?.y ?? 0}px`,
      } as CSSProperties}
      data-reference-id={reference.id}
      aria-label={uiCopy.workbench.reference.cardAria(reference.name, kindName)}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onSelect();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (multiMode) return;
        window.dispatchEvent(new CustomEvent("lantern-reference-context-open", { detail: reference.id }));
        onOpenContextMenu();
        onSelect();
        const menuWidth = 172;
        const menuHeight = 296;
        const viewportPadding = 16;
        // The card keeps a fixed layout width while its visible image can be
        // scaled down. Anchor to the actual right-click point so compact
        // references do not leave a large empty gap before their menu.
        const right = event.clientX + 10;
        const left = event.clientX - menuWidth - 10;
        const dockTop = document.querySelector<HTMLElement>(".creation-dock")?.getBoundingClientRect().top;
        const safeBottom = dockTop && dockTop < window.innerHeight ? dockTop - 12 : window.innerHeight - viewportPadding;
        const top = clampValue(event.clientY - 26, viewportPadding, Math.max(viewportPadding, safeBottom - menuHeight));
        const sideBlockers = Array.from(document.querySelectorAll<HTMLElement>(".creation-drawer:not(.closed), .agent-workspace.open, .version-workspace.open"));
        const placementScore = (leftEdge: number) => {
          const menuRect = { left: leftEdge, top, right: leftEdge + menuWidth, bottom: top + menuHeight };
          return sideBlockers.reduce((score, blocker) => score + overlapArea(blocker.getBoundingClientRect(), menuRect), 0);
        };
        const rightLeft = clampValue(right, viewportPadding, Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding));
        const leftLeft = clampValue(left, viewportPadding, Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding));
        const hasRoomOnRight = right + menuWidth <= window.innerWidth - viewportPadding;
        const menuLeft = !hasRoomOnRight || placementScore(leftLeft) < placementScore(rightLeft) ? leftLeft : rightLeft;
        setContextMenu({
          left: menuLeft,
          top,
        });
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (multiMode) return;
        const target = event.target;
        if (target instanceof Element && target.closest("button, [role='menu']")) return;
        event.stopPropagation();
        setContextMenu(null);
        onSelect();
        dragRef.current = {
          originX: position.x,
          originY: position.y,
          startX: event.clientX,
          startY: event.clientY,
          latestX: position.x,
          latestY: position.y,
          moved: false,
          viewEligible: target instanceof Element && Boolean(target.closest(".reference-image")) && !target.closest("button"),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        const next = { x: drag.originX + deltaX, y: drag.originY + deltaY };
        drag.latestX = next.x;
        drag.latestY = next.y;
        drag.moved = drag.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;
        setPosition(next);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!drag.moved) {
          setPosition({ x: drag.originX, y: drag.originY });
          const now = performance.now();
          const previous = lastViewClickRef.current;
          const isDoubleClick = drag.viewEligible
            && previous
            && now - previous.at <= 420
            && Math.abs(event.clientX - previous.x) <= 7
            && Math.abs(event.clientY - previous.y) <= 7;
          lastViewClickRef.current = isDoubleClick ? null : { at: now, x: event.clientX, y: event.clientY };
          if (isDoubleClick) {
            suppressClickRef.current = true;
            onView();
          }
          return;
        }
        lastViewClickRef.current = null;
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        onMove(drag.latestX, drag.latestY);
      }}
      onPointerCancel={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        lastViewClickRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setPosition({ x: drag.originX, y: drag.originY });
      }}
    >
      <div className={`reference-image ${reference.kind}`}>
        <img src={reference.imageSrc} alt={uiCopy.workbench.reference.imageAlt(reference.name)} draggable={false} loading="lazy" decoding="async" />
        {(reference.images?.length ?? 0) > 1 ? <button type="button" className="reference-image-cycle" aria-label={uiCopy.workbench.reference.switchImageAria(reference.name)} title={uiCopy.workbench.imagePicker.switchAssetImageTitle} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCycleImage(); }}><Icon name="replace" /></button> : null}
        <div className="reference-body">
          <em aria-label={kindName} title={kindName}>{kindGlyph}</em>
          <strong>{reference.name}</strong>
        </div>
      </div>
      {contextMenu ? createPortal(
        <FloatingMenu className="reference-context-menu" style={{ left: contextMenu.left, top: contextMenu.top }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
            <MenuSection className="reference-menu-section"><button type="button" onClick={() => { onReference(); setContextMenu(null); }}><span><Icon name="ai" />{uiCopy.asset.action.referenceInChat}</span></button></MenuSection>
            {isUploadedReference ? <><MenuDivider className="reference-menu-divider" /><MenuSection className="reference-menu-section"><button type="button" disabled={assetSaved} onClick={(event) => { const anchor = cardRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect(); onSaveToAssets({ left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom }); setContextMenu(null); }}><span><Icon name="save" />{assetSaved ? uiCopy.asset.status.linked : uiCopy.asset.action.saveToLibrary}</span></button></MenuSection></> : null}
            <MenuDivider className="reference-menu-divider" />
            <MenuSection className="reference-menu-section reference-menu-actions"><button type="button" onClick={(event) => {
              const item = event.currentTarget.getBoundingClientRect();
              const submenuWidth = 160;
              const submenuHeight = 134;
              const viewportPadding = 16;
              const right = item.right + 6;
              const left = item.left - submenuWidth - 6;
              const top = clampValue(item.top, viewportPadding, Math.max(viewportPadding, window.innerHeight - submenuHeight - viewportPadding));
              const blockers = Array.from(document.querySelectorAll<HTMLElement>(".creation-drawer:not(.closed), .agent-workspace.open, .version-workspace.open"));
              const score = (leftEdge: number) => blockers.reduce((total, blocker) => total + overlapArea(blocker.getBoundingClientRect(), { left: leftEdge, top, right: leftEdge + submenuWidth, bottom: top + submenuHeight }), 0);
              const rightLeft = clampValue(right, viewportPadding, Math.max(viewportPadding, window.innerWidth - submenuWidth - viewportPadding));
              const leftLeft = clampValue(left, viewportPadding, Math.max(viewportPadding, window.innerWidth - submenuWidth - viewportPadding));
              const opensRight = right + submenuWidth <= window.innerWidth - viewportPadding && score(rightLeft) <= score(leftLeft);
              setContextMenu((current) => current ? { ...current, layerMenu: { left: opensRight ? rightLeft : leftLeft, top } } : current);
            }}><span><Icon name="layers" />{uiCopy.workbench.action.layer}<span className="reference-menu-chevron"><Icon name="expand" /></span></span></button></MenuSection>
            <MenuDivider className="reference-menu-divider" />
            <MenuSection className="reference-menu-section reference-menu-zoom"><button type="button" onClick={() => updateZoom(zoom + 0.15)}><span><Icon name="zoomIn" />{uiCopy.workbench.action.zoomIn}</span></button><button type="button" onClick={() => updateZoom(zoom - 0.15)}><span><Icon name="zoomOut" />{uiCopy.workbench.action.zoomOut}</span></button><button type="button" onClick={() => updateZoom(1)}><span><Icon name="replace" />{uiCopy.asset.action.restore}</span></button></MenuSection>
            <MenuDivider className="reference-menu-divider" />
            <MenuSection className="reference-menu-section reference-menu-actions"><button type="button" className="danger" onClick={() => { onDelete(); setContextMenu(null); }}><span><Icon name="delete" />{uiCopy.common.action.removeFromCanvas}</span></button></MenuSection>
        </FloatingMenu>,
        document.body,
      ) : null}
      {contextMenu?.layerMenu ? createPortal(
        <FloatingMenu className="reference-context-menu reference-layer-menu" style={{ left: contextMenu.layerMenu.left, top: contextMenu.layerMenu.top }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
          <MenuSection className="reference-menu-section reference-menu-actions"><button type="button" onClick={() => { onLayer("top"); setContextMenu(null); }}><span><Icon name="layers" />{uiCopy.workbench.action.moveToFront}</span></button><button type="button" onClick={() => { onLayer("up"); setContextMenu(null); }}><span><Icon name="layers" />{uiCopy.workbench.action.moveLayerUp}</span></button><button type="button" onClick={() => { onLayer("down"); setContextMenu(null); }}><span><Icon name="layers" />{uiCopy.workbench.action.moveLayerDown}</span></button><button type="button" onClick={() => { onLayer("bottom"); setContextMenu(null); }}><span><Icon name="layers" />{uiCopy.workbench.action.moveToBack}</span></button></MenuSection>
        </FloatingMenu>,
        document.body,
      ) : null}
    </article>
  );
}
