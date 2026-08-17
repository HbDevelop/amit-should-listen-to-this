# Amit Should Listen To This 🎧

Interactive playlist: chat suggests songs, Amit listens and reacts. Everything is public and persistent.

Live at [hbdevelop.github.io/amit-should-listen-to-this](https://hbdevelop.github.io/amit-should-listen-to-this/).

## Structure

- `index.html` / `style.css` — the page
- `app.js` — logic (playlist, reactions, suggestions)
- `songs.js` — base playlist

## Updating the playlist

Edit `songs.js`, commit, push to `main`. The site redeploys automatically.

Note: this only adds *new* songs. Editing an already-published song's title/artist/note
won't update it live — only new songs and emoji reaction counts can be written from the
site itself.
