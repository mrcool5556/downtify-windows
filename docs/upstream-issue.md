# Draft: upstream issue for henriquesebastiao/downtify

Not posted yet. Review, then say "post it".

---

**Title:** Feature request: share playlists with other users (view-only), and detach imported playlists for editing

Hi, and thanks for Downtify. I run it at home with a few accounts, and I've been building a Windows desktop client for it ([downtify-windows](https://github.com/mrcool5556/downtify-windows): offline library, downloads with "keep synced", player with media keys, playlist editing over the web session). Two things came up that need the server, so I'm raising them here with as much detail as I can, in case it helps.

## 1. Sharing playlists with other users (view-only)

Today a playlist is visible only to its owner (and admins). Playback is already shared across users, so this is only about who can *see* a list.

**Visibility per playlist**, three levels:
- **Private** (default, today's behaviour).
- **Shared with specific users**: a list of usernames.
- **Public**: everyone on the server.

Liked Songs is never shareable.

**Where other people's playlists appear.** Never mixed into the user's own playlists. Two separate sections, every entry labelled with the owner's name:
- **Shared with me**: playlists aimed at you by name. Always shown; a newly shared one gets a small "new" marker until opened.
- **Public playlists**: everyone's public ones, sorted by owner then name, with search, showing owner, song count and whether you follow it. Controlled by a per-user preference "Show public playlists" (on by default, section collapsed).

**What a viewer can do:** play, shuffle, queue, download to their device (via the client), **follow** a public playlist so it stays pinned in their sidebar and updates when the owner changes it, and **save a copy** (a private, editable duplicate). No editing, renaming or deleting someone else's list.

**Unsharing:** when the owner makes a playlist private again or removes a user, it disappears from their sidebar (including followed) at the next sync. Saved copies stay with whoever made them.

**Admin switch:** a server setting "Allow users to share playlists", on by default, separate from the per-user "show public" preference.

**What the API would need (rough):**
- a `visibility` field (`private` | `shared` | `public`) plus a `shared_with` list on playlist owner records, honoured in `_playlist_visible` / `_filter_playlists_for`;
- `PUT /api/library/playlists/visibility` (owner only), and the same read-out under `/api/v1/playlists` with `owner`, `visibility`, `followed`;
- `POST/DELETE /api/v1/playlists/follow`;
- a small usernames-only endpoint for the share picker (users can't list accounts today);
- WebSocket `playlists_changed` so clients refresh.

Collaborative editing (letting named users add/remove songs) would be a natural second step, but it needs a proper permission model (share list vs edit list, "added by", conflict handling), so I'm deliberately leaving it out of this request.

## 2. Detach an imported playlist into an editable one

Playlists that came from a Spotify or YouTube Music link are refused by `edit_manual_playlist` (`_require_manual`: "is imported and cannot be edited"). I understand they stay linked to their source so the monitor can keep them in step. As a user I'd still like to tidy one up. The smallest change I can see is a **"detach"** action: turn an imported playlist into a manual one, keeping its tracks and owner and dropping the source link (and its monitor entry). An alternative is allowing add/remove on imported lists with the monitor treating manual removals as "don't re-add", but detach seems simpler and more predictable.

Happy to test either, and to open a PR if you'd rather point me at how you'd like it done.
