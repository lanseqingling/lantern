# Comics, chapters, and assets

Load this reference when the creator asks to organize a comic, manage a chapter, or save confirmed character, scene, prop, or reference information.

## Resolve the intended resource

Prefer a Lantern Resource Reference already supplied by the creator or returned by a Lantern tool. Canonical references use stable forms such as:

```text
lantern://comics/{comicId}
lantern://chapters/{chapterId}
lantern://assets/{assetId}
lantern://candidates/{candidateId}
```

A current local Lantern browser link can identify the same comic or chapter. Keep the complete link so Lantern can validate any Comic → Chapter relationship. A resource reference identifies a target but does not grant access; Lantern still checks the current owner and archived state.

Use `lantern_scope_resolve` before project context:

- Pass through a complete local Lantern link or `lantern://` reference when the creator supplied one.
- Otherwise, extract an accurate Comic title and Chapter title or number from the creator's wording. Scope resolution uses exact, owner-bounded matches and refuses ambiguity; it is not fuzzy title guessing.
- Reuse the returned Chapter or Project URI as the current discussion scope. If the user changes the intended work, resolve the new scope instead of carrying the old one forward.
- List projects only when the creator supplied neither a usable reference nor an accurate name, or when they explicitly ask to browse their work.

For page work, call `lantern_context_get` with the stable Chapter or Project `scope`. Translate a printed page number into `physicalPageNumber`, an explicit PresentationUnit ordinal into `position`, and an accurate page name into `name`. Select pages, PageSurfaces, frames, images, balloons, and text only from the returned labels and aliases, then use their opaque handles. Do not ask the creator for `projectId`, `pageId`, surface IDs, or element IDs.

## Keep resource scopes distinct

- A Comic owns the story summary, world summary, visual-style summary, page format, and ordered Chapters.
- A Comic cover is a comic-level image used outside individual Chapters. It is distinct from a Chapter cover page and must use the dedicated comic-cover capabilities.
- Visual-style images are the Comic's global visual baseline. They are a dedicated special resource, not an ordinary `reference_image` Asset; use the dedicated visual-style capabilities to read or manage them.
- Creating a Chapter also creates its editable Project and initial Working Revision. Do not create or treat a Project as independent comic content.
- An Asset is reusable comic material. Its name, kind, and confirmed description are structured facts; an Asset Version fixes a concrete image or other immutable resource.
- Saving a confirmed character, scene, or prop description is a direct resource mutation. Designing missing creative details or generating an image remains a generative action and must follow the Candidate boundary exposed by Lantern.

Use the resource URI returned by a create, duplicate, resolve, or read result for every follow-up mutation. After creating the first Chapter, use its returned Project only for page context and LCD editing—not as a substitute for the Comic or Chapter reference.

## Apply destructive intent narrowly

Archiving a Comic, Chapter, or Asset is destructive. Only call the matching archive capability after the creator has explicitly confirmed that exact resource. Do not infer confirmation from a broad cleanup request when several resources could match.

Comic-cover and visual-style image uploads use the same prepare → raw PUT → attach transport described in [assets.md](assets.md), but their target remains the Comic. Never create a generic Asset card as a substitute.
