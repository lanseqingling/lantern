# Page structure and page-manga operations

Load this reference when the creator wants to create, name, duplicate, order, delete, merge, or split pages.

## Read page identity correctly

`lantern_context_get` returns two complementary page views:

- `pageSequence` is the lightweight Chapter reading sequence. It lists every PresentationUnit by reading position, role, kind, optional name, and physical page numbers without exposing content handles for the whole Chapter.
- `pages` contains at most the requested two PresentationUnits with revision-bound page and PageSurface handles.

Use `physicalPageNumber` when the creator identifies a printed story page. Use `position` only for an explicit PresentationUnit position in the Chapter reading sequence, and use `name` for an accurate custom name or unambiguous role alias. A true spread has one reading position and two physical page numbers. A cover has one reading position and no physical story-page number.

## Distinguish the three page roles

- `story` is a normal story page and can contain comic Frames and dialogue.
- `cover` is unique within a Chapter, always remains first, has one surface, and does not consume a physical story-page number.
- `interlude` is a transition or special paper page. It participates in reading order and physical numbering like story pages, but only another adjacent interlude can merge with it.

Page roles are fixed at creation. Cover and interlude pages support paper-level images and narration but do not accept new comic Frames or dialogue. Lantern enforces cover uniqueness, fixed order, supported paper content, and valid page numbering; do not simulate those rules with extra moves or raw document edits.

## Distinguish display pairs from true spreads

Two ordinary pages shown together by a reader or workbench remain separate PresentationUnits. Do not merge them merely because they are visually paired.

A true spread is one `spread` PresentationUnit with exactly two PageSurfaces. `surfaceReadingOrder` follows the Chapter reading direction: left then right for LTR, right then left for RTL. Use the returned `page_surface` handles to identify a physical side in later surface-aware operations; do not reconstruct a surface ID.

Only adjacent ordinary pages with the same `story` or `interlude` role can become a true spread. Splitting is rejected when a frame or paper object crosses the gutter and cannot be preserved on one surface.

## Apply the narrow page action

- Create a story or interlude relative to one current page handle with `side: before | after`. A cover still uses one current page handle to bind ownership and revision, but Lantern fixes its position.
- Rename one page without changing its role or order. An empty name restores the derived label.
- Duplicate one non-cover PresentationUnit. A true spread is duplicated as one complete unit.
- Move a page with two handles: the page to move first, the reference page second, plus `side`.
- Merge two adjacent pages using their two handles; their input order does not replace the Chapter reading order.
- Split one true-spread handle.
- Delete only after the creator confirms the exact page. Pass the same handle in `targetHandles` and `confirmedTargetHandles`.

Every page mutation is revision-bound, idempotent, and atomic inside the AgentDraft. After the first success, continue from that draft and read fresh context before locating another page. Reuse the same idempotency key only for an exact retry of the same logical action. The finished task becomes one ChangeProposal for the creator to review.

Page-manga capabilities do not authorize rolling-segment creation, device viewport management, scroll grouping, or cross-segment composition.
