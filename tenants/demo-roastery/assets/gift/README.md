# Gift-card art

Artwork for the gift cards members send, one `.webp` per design, named by the
design's stable key: `<design-key>.webp`. The key is persisted on issued gift
cards, so a file — and its key — is never renamed once live.

Landscape card art, roughly 3:2 (the house set is 1000×671), WebP. The app's
gift-design catalog maps each key to its art; dropping files here without a
catalog entry ships nothing, and a catalog entry without its file fails the
bundle.
