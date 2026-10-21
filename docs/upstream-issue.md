# Upstream issue for henriquesebastiao/downtify

Posted 2026-10-20 as https://github.com/henriquesebastiao/downtify/issues/465.

---

**Title:** Feature request: share playlists with other users (view-only), and detach imported playlists so they can be edited

Hi, and thanks for Downtify, it has replaced a few things in my house.

I run it with several accounts and I've been writing a Windows desktop client for it ([downtify-windows](https://github.com/mrcool5556/downtify-windows): offline library, downloads with "keep synced", a player with Windows media keys, playlist editing over the web session). Two things came up that can only be done on the server, so I'm raising them here with the detail I'd want if I were implementing them. Happy to trim any of it.

## 1. Share playlists with other users (view-only)

Today a playlist is visible only to its owner, plus admins. Playback is already shared between users, so this is purely about who can *see* a list.

**Visibility per playlist**, one of three:
- **Private**: today's behaviour, the default.
- **Shared with specific users**: a list of usernames.
- **Public**: everyone on the server.

Liked Songs is never shareable.

**Where other people's playlists appear.** Never mixed into the user's own playlists. Two separate sections, every entry labelled with the owner:
- **Shared with me**: playlists aimed at you by name. Always shown. A newly shared one carries a "new" marker until opened.
- **Public playlists**: everyone's public ones, sorted by owner then name, searchable, showing owner, song count and whether you follow it. Behind a per-user preference "Show public playlists", on by default, section collapsed.

**What a viewer can do:** play, shuffle, queue, download to their device through a client, **follow** a public playlist so it stays pinned in their sidebar and tracks the owner's changes, and **save a copy** (a private, editable duplicate). No editing, renaming or deleting of someone else's list.

**Unsharing:** when the owner makes a playlist private again or removes a user, it leaves that user's sidebar (followed or not) at the next sync. Saved copies stay with whoever made them.

**Admin switch:** a server setting "Allow users to share playlists", on by default. This is separate from each user's own "show public playlists" preference.

**Roughly what the API would need:**
- a `visibility` (`private` | `shared` | `public`) field and a `shared_with` list on the playlist owner records, honoured in `_playlist_visible` and `_filter_playlists_for`;
- `PUT /api/library/playlists/visibility` (owner only), and `owner`, `visibility` and `followed` on the `/api/v1/playlists` rows;
- `POST` / `DELETE /api/v1/playlists/follow`;
- a usernames-only endpoint for the share picker, since normal users can't list accounts today;
- a `playlists_changed` WebSocket message so clients refresh.

Collaborative editing (named users adding and removing songs) would be a natural second step, but it needs a real permission model (share list vs edit list, "added by", conflicts), so I'm deliberately keeping it out of this request.

## 2. Detach an imported playlist so it can be edited

Playlists imported from a Spotify or YouTube Music link are refused by `edit_manual_playlist` (`_require_manual`: "is imported and cannot be edited"). I understand they stay linked to their source so the monitor can keep them in step, but as a user I still want to tidy one up: drop a song that doesn't belong, add one that does.

The smallest change I can see is a **detach** action: convert an imported playlist into a manual one, keeping its tracks and owner and dropping the source link and its monitor entry. The alternative, allowing add/remove on imported lists with the monitor treating manual removals as "don't re-add", works too but is harder to explain to users.

Happy to test either, and to open a PR if you'd rather point me at how you'd like it done.
