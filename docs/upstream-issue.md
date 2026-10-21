# Draft: upstream issue for henriquesebastiao/downtify

Not posted yet. Review, edit, then say "post it".

---

**Title:** Feature request: edit imported playlists, and share a playlist with other users

Hi, and thanks for Downtify. I run it at home with a few accounts and I've been building a Windows desktop client for it ([downtify-windows](https://github.com/mrcool5556/downtify-windows): offline library, downloads with "keep synced", player with media keys, playlist editing over the web session). Two things came up while building it that need changes on the server side, so I'm raising them here.

**1. Editing imported playlists**

Playlists that came from a Spotify or YouTube Music link are refused by `edit_manual_playlist` (`_require_manual`: "is imported and cannot be edited"). I understand they stay linked to their source so the monitor can keep them in step, but as a user I'd like to tidy one up (remove a song I don't want, add one that belongs). Two options I can see:

- a "detach" action that turns an imported playlist into a manual one, keeping its tracks and owner and dropping the source link; or
- allow add/remove on imported playlists and have the monitor treat manual removals as "don't re-add".

Either would do. Detach is probably the smaller change.

**2. Sharing a playlist with other users**

Today a playlist is visible only to its owner (and admins). It would be great to mark a playlist as visible to everyone on the server, so a family or a group of friends can share mixes. From the code it looks like a `visibility` flag on the playlist owner records honoured in `_playlist_visible`, plus a small endpoint to set it (and the same under `/api/v1` so clients can show the switch). Playback is already shared across users, so this is only about the listing.

Happy to help test either, and to open a PR if you'd rather point me at how you'd like it done.
