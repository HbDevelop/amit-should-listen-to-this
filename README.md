# Amit Should Listen To This 🎧

Interactive playlist: chat suggests songs, Amit listens and reacts. Everything is public and persistent (visible to every visitor).

Fully static site, hosted for free on **GitHub Pages**. Data (playlist + reactions) is stored on **Firebase Firestore**, whose free tier (Spark) requires no credit card and no commitment.

## Setup (one-time, ~5 minutes)

### 1. Create the Firebase project (free)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with a Google account.
2. "Add project" → give it a name (e.g. `amit-playlist`) → you can disable Google Analytics, it's not needed.
3. Once the project is created, click the **`</>`** ("Web") icon to add a web app.
4. Give it a name, **don't check** "Firebase Hosting" (we're using GitHub Pages).
5. Firebase gives you a `firebaseConfig` object — copy it and paste it into [firebase-config.js](firebase-config.js) at the root of this repo, replacing the `REPLACE_ME` values.

### 2. Enable Firestore

1. In the left menu: **Build → Firestore Database → Create database**.
2. Choose **production mode**, a region close to your audience (e.g. `us-central`).
3. Once created, go to the **Rules** tab and replace the content with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /songs/{songId} {
      allow read: if true;
      allow create: if request.resource.data.title is string
                    && request.resource.data.title.size() < 120
                    && request.resource.data.artist is string
                    && request.resource.data.youtubeId is string;
      allow update: if request.resource.data.diff(resource.data).affectedKeys()
                    .hasOnly(['counts']);

      match /reactions/{reactionId} {
        allow read: if true;
        allow create: if request.resource.data.comment is string
                      && request.resource.data.comment.size() < 300;
      }
    }
  }
}
```

These rules allow public reads, creating suggestions/reactions, and block arbitrary deletion or edits (only the emoji counter can be incremented). It's a fun project without authentication: a motivated troll could still spam it, but nothing destructive is possible.

4. **Publish** the rules.

### 3. Push the code to GitHub

Once `firebase-config.js` is filled in, commit and push (I can do this for you if you ask).

### 4. Enable GitHub Pages

1. On the GitHub repo → **Settings → Pages**.
2. Source: **Deploy from a branch** → branch `main`, folder `/ (root)`.
3. The site will be live at `https://hbdevelop.github.io/amit-should-listen-to-this/` within 1-2 minutes.

That's it — no build step, no server to manage, no bill.

## Structure

- `index.html` / `style.css` — the page
- `app.js` — logic (playlist, reactions, suggestions) via Firestore
- `songs.js` — base playlist; edit this list then push to update the site
- `firebase-config.js` — your Firebase keys (public by nature, security comes from the Firestore rules)

## Updating the playlist later

Edit `songs.js`, commit, push to `main`. GitHub Pages redeploys automatically within seconds.

Note: this only adds *new* songs (new `id`s). Editing the title/artist/note of a song that's
already in Firestore won't retroactively update it there — the Firestore rules deliberately
block edits to existing songs from the client (only new songs and emoji counters are allowed),
so a random visitor's browser can't rewrite the curated playlist. To fix a typo in an
already-seeded song, edit it directly in the Firebase console (Firestore Database → the
`songs` collection).
