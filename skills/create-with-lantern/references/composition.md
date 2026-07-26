# LCD structure and final composition

Load this reference when the creator asks to inspect or discuss pages, rolling segments, frames, placed images, crops, balloons, paper text, overlap, layers, whitespace, or reading flow. Also load it when an LCD mutation is actually present in the current capability catalog and choosing its parameters depends on composition evidence.

## Separate understanding from permission

LCD context describes the creator's current work; it is not a writable document interface. Structure, rendered images, IDs, and opaque handles do not grant an edit operation. Before preparing any mutation, confirm that `lantern_capabilities_list` contains the exact requested action and respect its effect, target scope, revision, confirmation, and Candidate boundary.

If only observation is available, answer questions and offer composition findings, but do not fabricate an edit tool, submit raw LCD, reinterpret an object ID as a handle, or redirect the request into a loosely related capability.

## Read the object model accurately

- A `PresentationUnit` is one shared reading and composition space: an ordinary page, a spread, or a rolling unit.
- A `PageSurface` is a physical output region inside that unit. It clips output but does not create another general-purpose object hierarchy.
- A `Frame` is a comic panel in unit coordinates. Its internal layers and elements compose inside the frame and normally obey its mask and clipping.
- A frame-layer image, balloon, or text element uses coordinates local to its Frame. Its resolved unit geometry is an observation projection, not another stored position to edit independently.
- A Unit Overlay belongs to the PresentationUnit. It may represent paper-level, cross-frame, cross-page, or frame-anchored content and can remain visible outside a frame border.
- A fixed `AssetVersion` identifies source content. A placed image element owns its placement, transform, and crop; changing those does not rewrite the Asset Version.

Do not infer ownership from where pixels happen to appear. Use the structure projection's ownership, anchoring, clipping, and surface fields.

## Use two kinds of evidence together

- The structure projection identifies PresentationUnits, surfaces, frames, elements, resolved geometry, crop, ownership, clipping, layer order, dialogue, and reading sequence.
- The rendered image shows the final visible result after frame masks, crops, overflow, overlap, text, balloons, effects, and unit overlays are composed.

Use structure for exact targets and parameters. Use the rendered image for visual judgments. Do not infer object identity from pixels, and do not claim a composition looks correct from structure alone.

## Keep the observation bounded and current

Use one PresentationUnit for an ordinary page or rolling segment. Pass the current Chapter or Project URI as `scope`, and locate the page by its reading position or accurate name instead of asking for an internal ID. Request two units only when the creator is explicitly comparing an adjacent visible pair, then pass the returned `presentation_unit` handles to `lantern_composition_inspect`. Every result is fixed to one Working Revision; after a mutation or stale-handle error, read context and composition again.

The returned labels and aliases help map the creator's wording to one bounded object. The opaque handles returned for units, PageSurfaces, frames, and elements are the only valid targets for later LCD capabilities. Never reconstruct them from IDs shown in the structure projection.

## Interpret geometry, crop, and order

- A PresentationUnit owns the complete composition canvas. A PageSurface is a physical output region within it; a spread remains one PresentationUnit.
- Frame geometry is expressed in unit space. Frame-layer element transforms are local to their Frame and are projected into resolved unit-space geometry for observation.
- Each projected element exposes its stored `transform`, its `coordinateSpace`, and its resolved `geometry`. Edit `transform` in the declared coordinate space; use `geometry` only to judge the final unit-space result.
- Unit overlays compose outside frame clipping. A frame-anchored overlay follows its Frame but can remain visible beyond the frame border.
- Image crop is part of the placed image element, not a mutation of its fixed Asset Version.
- Moving or resizing a Frame is not the same action as changing an element's local transform or image crop. Never substitute one operation for another.
- Reading sequence, text order, and visual z-order are separate. Do not infer dialogue or panel order only from array order, vertical position, horizontal position, or overlap.

## Turn evidence into a bounded decision

For visual analysis, first identify the exact unit, frame, or element from structure, then describe only the relevant visible result from the rendered image. Treat crop, clipping, overlap, whitespace, and reading flow as findings only when the final composition supports them.

For an available mutation, preserve every property outside the creator's stated intent. Target only returned opaque handles, use the observation's source revision as required by the capability, and inspect the new AgentDraft revision again before claiming the visual result is correct. Structural, multi-object, generated, or otherwise high-risk changes remain Candidates when the catalog says so; the complete task is still frozen as one ChangeProposal.

Before proposing a visual change, identify the exact unit and element handle, describe the relevant visible evidence, and preserve any creator decision that is not part of the requested change.

For a read-only craft review, use geometry to explain visible relationships rather than grading a page from coordinates alone. Bleed should serve an intentional edge connection, a breakout should keep a clear anchor to its Frame, visual z-order should not be confused with reading order, and important text or subjects should remain legible in the final composition. These are review principles unless the LCD or Capability contract declares a hard invariant.
