# Question: could manual playlists hold more than 500 tracks?

Hi, and thanks again for adding sharing so quickly last time.

I ran into the 500-track limit on manual playlists (`MAX_TRACKS_PER_EDIT` in `downtify/manual_playlists.py`). I had imported a Spotify playlist with 747 tracks and tried to copy all of it into one of my own playlists. The edit was refused with "Playlists can hold at most 500 tracks", and nothing was added.

I'm not sure whether the limit is there for a reason I'm missing, like performance or keeping edits small. If it isn't, would you be open to raising it, or letting it be set in the config? Imported playlists don't seem to have a cap, so I wondered whether manual ones could work the same way.

Thanks for all your work on Downtify!
