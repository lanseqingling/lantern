# Asset images and derived forms

Load this reference when the creator wants to add an image to an Asset, choose its primary image, rename or archive an image slot, or manage another form of the same character, scene, or prop.

The same binary transport is used for a Comic cover and Comic visual-style images, but those are dedicated comic-level resources. Use their dedicated capabilities and keep the Comic URI as the target; do not represent either one as a generic Asset card.

## Keep identity, form, slot, and version distinct

- The root Asset is the reusable identity and confirmed description.
- A derived form is another Asset in the same family, such as a costume, age, state, or viewpoint that needs its own description and images.
- An image slot is a stable gallery position with a creator-facing label. The first slot is the primary image.
- An Asset Version is immutable image content. Reordering, renaming, or archiving a slot never rewrites that fixed version.

Use the returned `versionId` whenever later work must remain pinned to the exact image that was reviewed. Do not replace a fixed reference with the current primary image merely because the gallery order changed.

## Upload binary content outside tool arguments

Do not put image bytes or large base64 strings in an MCP tool call. Use the upload flow exposed by Lantern:

1. Prepare a short-lived upload position for one precise Asset.
2. PUT the raw PNG, JPEG, or WebP bytes to the returned loopback URL with exactly the returned headers.
3. Attach the completed upload to the same Asset, creating one immutable Asset Version and one image slot.

The upload position is temporary and does not itself add an image to the Asset. Never expose or invent an object-storage key, reuse an upload position for a different Asset, or treat a local client path as a Lantern resource.

## Retry mutations safely

Follow the Skill's general idempotency rule. Preparing an upload and attaching its completed bytes are two distinct logical mutations and therefore use different keys. A conflict means a key was already bound to another request; do not work around it by silently changing the intended action.

## Preserve creator decisions

Adding an image does not automatically make it primary. Change the primary slot only when the creator asks or the requested action clearly names the new image as primary. Archiving a slot or derived form is destructive and requires explicit confirmation for that exact target; it must not delete immutable versions still referenced by working revisions or saved snapshots.
