# Ideas index

Passing ideas, parked with enough detail to pick up later. Newest first.

## Editable imported playlists (2026-10-20)

**Want:** add, remove and reorder songs on a playlist that was imported from a Spotify or YouTube Music link.

**Blocker:** the server refuses with "is imported and cannot be edited" (`downtify/manual_playlists.py`, `_require_manual`). Imported playlists stay tied to their source so the server can re-check it and download missing songs.

**Routes:** upstream issue (filed together with the public-playlists one), or a fork that lets an imported playlist be "detached" into an editable one. App-side workaround: select all, Add to playlist, New playlist, which makes an editable copy.

## Public / shared playlists (2026-10-20)

**Want:** a switch on a playlist that lets other users on the same Downtify server see and play it. Today playlists are private to their owner and only admins see everyone's.

**Blocker:** this is a server feature. The Downtify server has no visibility flag, endpoint or schema field for sharing (checked `downtify/api.py` `_playlist_visible` and `_filter_playlists_for`, `manual_playlists.py`, `playlist_catalog.py`, docs/features/users.md).

**What it would take:**
1. Server: a `visibility` (private/public) field on the playlist owner records, honoured in `_playlist_visible`, plus `PUT /api/library/playlists/visibility` and the same under `/api/v1`.
2. Web UI: a toggle on the playlist page.
3. This app: a toggle on the playlist page, next to "Keep synced to this PC".

**Routes:** ask the Downtify author (issue or PR on github.com/henriquesebastiao/downtify), or run a small fork of the server container.
