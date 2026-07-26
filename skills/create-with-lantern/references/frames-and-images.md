# Frames and fixed-image composition

Load this reference for available frame and image composition capabilities. These operations are deterministic, revision-bound Working Revision changes; they do not invoke image generation.

## Read before targeting

Use bounded page context, then inspect the current composition. Page and PageSurface handles come from context; Frame and image handles come from composition inspection. After every successful change, discard all old handles and read the new revision before selecting the next object.

Use the rendered page to judge the visible result and the structure projection to choose the exact target. Never reconstruct a handle from a displayed object ID.

## Keep coordinate spaces distinct

- Frame geometry uses absolute `unit` coordinates and must remain inside its PageSurface.
- A frame-layer image uses normalized `frame_local` transform coordinates. `{x: 0, y: 0, width: 1, height: 1}` fills its Frame before crop.
- A frame-anchored breakout remains `frame_local`, follows the Frame, and can extend beyond the Frame mask.
- A paper image uses absolute `unit` coordinates.
- The inspection result's `geometry` is the resolved unit-space projection. Do not write it back as a frame-local transform.
- Image crop is normalized to the fixed source image and does not modify its AssetVersion.

## Compose Frames narrowly

Create a Frame only on a story page. Set exact geometry and, when needed, a 1-based reading position. Enable overlap explicitly before creating or moving overlapping Frames. Visual `zIndex` and reading position are independent.

Use `{kind: "rect"}` for a straight-corner rectangle or a four-point polygon for a controlled slant. Rounded and elliptical Frames may exist in imported or previously authored LCD, but the current external composition capability does not edit them. Keep polygon points ordered around a convex shape and avoid extreme corners that collapse the visible area. Bleed is a per-edge operation that extends that edge to its PageSurface boundary; change geometry and bleed in separate revision-bound calls.

Duplicate and delete only the exact returned Frame handle. Deleting a Frame also removes its frame-anchored overlays, but does not delete reusable Assets or immutable image versions.

## Place and edit fixed images

Use an Asset URI and, when the creator needs exact reproducibility, an explicit `assetVersionId`.

- Place on a Frame for clipped panel art.
- Place on a page or PageSurface for paper-owned art.
- Replace an image without changing its element identity, transform, or crop unless the same request explicitly changes those fields.
- Use `placement: breakout` only for a frame-layer image.
- Use `placement: page` to convert a frame-layer or frame-anchored image into paper-owned art.
- Overlay `zOrder` affects paper or breakout layers. A frame-layer image follows its Frame's visual layer.

The same fixed image may be placed more than once with different crop values. This creates distinct placement elements referencing one immutable AssetVersion.

## Bring images from the host

Lantern MCP does not expose image generation or an internal image Provider. If the creator needs new pixels, use the host Agent's own image capability or a user-provided PNG, JPEG, or WebP, then:

1. create or choose the correct Asset card;
2. prepare and complete the external upload;
3. attach it as an immutable AssetVersion;
4. place that fixed version through the image composition capability.

Do not put local paths, image bytes, base64, provider credentials, or object-storage keys into composition tool arguments.

For consistency review, inspect the placed image's exact AssetVersion handle and the relevant character, scene, prop, or visual-style version handles. The page preview is evidence of the final crop and composition; the returned AssetVersion image is evidence of its fixed source. Do not compare against whichever asset image is currently primary when the placed element pins another version.
