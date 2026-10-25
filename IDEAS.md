# Ideas index

Passing ideas, parked with enough detail to pick up later. Newest first.

## Editable imported playlists (2026-10-20) — DONE upstream in 3.7.0 as "Detach from source"

**Want:** add, remove and reorder songs on a playlist that was imported from a Spotify or YouTube Music link.

**Blocker:** the server refuses with "is imported and cannot be edited" (`downtify/manual_playlists.py`, `_require_manual`). Imported playlists stay tied to their source so the server can re-check it and download missing songs.

**Routes:** upstream issue henriquesebastiao/downtify#465 (filed 2026-10-20), or a fork that lets an imported playlist be "detached" into an editable one. App-side workaround: select all, Add to playlist, New playlist, which makes an editable copy.

## Public / shared playlists (2026-10-20) — DONE upstream in 3.7.0 (view-only sharing, follow, save a copy)

**Want:** a switch on a playlist that lets other users on the same Downtify server see and play it. Today playlists are private to their owner and only admins see everyone's.

**Blocker:** this is a server feature. The Downtify server has no visibility flag, endpoint or schema field for sharing (checked `downtify/api.py` `_playlist_visible` and `_filter_playlists_for`, `manual_playlists.py`, `playlist_catalog.py`, docs/features/users.md).

**What it would take:**
1. Server: a `visibility` (private/public) field on the playlist owner records, honoured in `_playlist_visible`, plus `PUT /api/library/playlists/visibility` and the same under `/api/v1`.
2. Web UI: a toggle on the playlist page.
3. This app: a toggle on the playlist page, next to "Keep synced to this PC".

**Routes:** upstream issue henriquesebastiao/downtify#465 (filed 2026-10-20), or run a small fork of the server container.

- **Drag to reorder songs in a playlist** (2026-10-24). The server has no reorder endpoint (add/remove only, adds go to the end). Parked: ask upstream for a "reorder" option, asked in a comment on henriquesebastiao/downtify#488 on 2026-10-24, then build drag-to-reorder on it. A client-only workaround (remove the tail, re-add in order) works but leaves a playlist short if the second call fails.
