# Frames and fixed-image composition

Load this reference for available frame and image composition capabilities. These operations are deterministic, revision-bound AgentDraft changes for external creation tasks; they do not invoke image generation.

## Read before targeting

Use bounded page context, then inspect the current composition. Page and PageSurface handles come from context; Frame and image handles come from composition inspection. After the first successful change, continue from the returned AgentDraft. After every change, discard all old handles and read its new revision before selecting the next object.

Use the rendered page to judge the visible result and the structure projection to choose the exact target. Never reconstruct a handle from a displayed object ID.

## Keep coordinate spaces distinct

- Frame geometry uses absolute `unit` coordinates and must remain inside its PageSurface.
- A frame-layer image uses normalized `frame_local` transform coordinates. `{x: 0, y: 0, width: 1, height: 1}` fills its Frame before crop.
- A frame-anchored breakout remains `frame_local`, follows the Frame, and can extend beyond the Frame mask.
- A paper image uses absolute `unit` coordinates.
- A cross-page image exists once in a true spread and also uses absolute `unit` coordinates; it must visibly cross both physical pages. Target the spread's `presentation_unit` handle, never either `PageSurface` handle.
- The inspection result's `geometry` is the resolved unit-space projection. Do not write it back as a frame-local transform.
- Image crop is normalized to the fixed source image and does not modify its AssetVersion.

## Compose Frames narrowly

Create a Frame only on a story page. Set exact geometry and, when needed, a 1-based reading position. Enable overlap explicitly before creating or moving overlapping Frames. Visual `zIndex` and reading position are independent.

Honor a creator-specified location. When the usual size does not fit there, prefer a smaller gutter-safe Frame near that location over silently moving it to a distant open area. Do not shrink it until it becomes unusable merely to satisfy spacing.

Use `{kind: "rect"}` for a straight-corner rectangle or a four-point polygon for a controlled slant. Rounded and elliptical Frames may exist in imported or previously authored LCD, but the current external composition capability does not edit them. Keep polygon points ordered around a convex shape and avoid extreme corners that collapse the visible area. Bleed is a per-edge operation that extends that edge to its PageSurface boundary; change geometry and bleed in separate revision-bound calls.

Duplicate and delete only the exact returned Frame handle. Deleting a Frame also removes its frame-anchored overlays, but does not delete reusable Assets or immutable image versions.

## Resize Frames without scaling their contents

Resizing a Frame changes its viewport, not the visible size of its frame-local balloons, text, effects, or non-fill images. Lantern rebases their local transforms to preserve their resolved unit-space geometry; the primary fill image adjusts its crop so its visual scale and position remain stable while the resized Frame changes what is visible. A Frame with non-fill primary art cannot expand beyond the area that artwork covers, so a resize never exposes blank paper; revise the source crop or transform first when more viewport is needed. Moving a Frame is different: frame-local content follows it.

After resizing, inspect the new draft for intentional clipping. Do not compensate by resizing each child unless the creator separately asks to change those objects.

## Place and edit fixed images

Use an Asset URI and, when the creator needs exact reproducibility, an explicit `assetVersionId`.

- Place on a Frame for clipped panel art.
- Place on a page or PageSurface for paper-owned art.
- Replace an image without changing its element identity, transform, or crop unless the same request explicitly changes those fields.
- Use `placement: breakout` only for a frame-layer image.
- Use `placement: page` to convert a frame-layer or frame-anchored image into paper-owned art.
- Use `image.place` with `placement: cross_page` to place one fixed image across a true spread. Use `image.update placement: cross_page` only to convert an already cross-gutter paper image; refresh context after either ownership change.
- Overlay `zOrder` affects paper or breakout layers. A frame-layer image follows its Frame's visual layer.

## Compose a true spread

Only a true spread can hold cross-page objects. First use the returned `presentation_unit` handle to place a cross-page image, then inspect the resulting draft before adding other content. The image is stored once and is separately clipped by the left and right physical pages at preview and export; do not duplicate it into two paper images.

To make a panel itself cross the gutter, call `frame.update` with `crossPage: true` on a Frame in a true spread, refresh context, then make its geometry change in a separate call. Frame-local art and a bound true-breakout foreground remain attached to that Frame, so they cross and move together. A cross-page Frame or object blocks splitting the spread until it is returned to one physical page.

The same fixed image may be placed more than once with different crop values. This creates distinct placement elements referencing one immutable AssetVersion.

## Create a bound true breakout

Use `image.breakout.create` when a character, hair, clothing, weapon, prop, or coherent foreground effect should cross its source Frame while the complete panel image remains clipped inside. Target the frame image itself. This creates a frame-anchored transparent projection whose transform and crop remain bound to that source image; moving or reframing the source updates both. `image.update placement=breakout` is a different operation that migrates one existing image out of the Frame and does not create this two-projection composition.

Prepare the foreground outside Lantern from the exact fixed source image returned through its image handle:

- use PNG, or lossless WebP with alpha; never use JPEG for a true-breakout foreground;
- preserve the source pixel dimensions, canvas origin, color, and subject pixels;
- hide only the background through alpha instead of regenerating the subject;
- retain one continuous subject region crossing the border plus enough interior overlap to avoid a seam;
- exclude baked panel borders, balloons, text, neighbouring panels, and page-preview pixels;
- keep the full source canvas instead of tightly cropping around the subject.

Upload the result as a fixed Asset Version, call `image.breakout.create` with that asset while targeting the source frame-image handle, then inspect the new composition. Check alignment, alpha halos, doubled edges, border visibility, neighbouring-frame occlusion, and reading clarity. The foreground cannot be transformed or cropped independently; remove it to end the binding. Lantern does not perform segmentation, background removal, subject regeneration, or hidden mask editing in this capability.

## Bring images from the host

Lantern MCP does not expose image generation or an internal image Provider. If the creator needs new pixels, use the host Agent's own image capability or a user-provided PNG, JPEG, or WebP, then:

1. decide whether the image is a reusable Asset-space baseline or a one-off composition source;
2. use the narrow upload and immutable-version registration capability exposed for that resource kind;
3. place that fixed version through the image composition capability.

Do not create a reusable Asset card for each ordinary Frame image merely to transport generated pixels. Save it to Asset Space only when the creator asks, when it establishes a reusable identity or baseline, or when future reuse is part of the task. If the current catalog exposes only an Asset-card upload for new pixels, report that capability limit instead of silently claiming an Asset-space-free placement.

Do not put local paths, image bytes, base64, provider credentials, or object-storage keys into composition tool arguments.

Follow the generation-unit contract in [comic-creation.md](comic-creation.md). An image intended for one Frame is one independent visual source by default, without baked-in panel grids, borders, balloons, text, or page layout. Batch generation is acceptable when it returns separate files for separate placements. Covers, intentional full-page or true-spread art, paper backgrounds, creator-supplied flattened pages, and explicitly requested flattened compositions are valid exceptions.

For consistency review, inspect the placed image's exact AssetVersion handle and the relevant character, scene, prop, or visual-style version handles. The page preview is evidence of the final crop and composition; the returned AssetVersion image is evidence of its fixed source. Do not compare against whichever asset image is currently primary when the placed element pins another version.
