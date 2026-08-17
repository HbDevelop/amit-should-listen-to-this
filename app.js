import { firebaseConfig } from "./firebase-config.js";
import { SEED_SONGS } from "./songs.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const EMOJIS = ["😍", "🔥", "😴", "🤯", "🤮"];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const songsCol = collection(db, "songs");

const listEl = document.getElementById("song-list");
const suggestForm = document.getElementById("suggest-form");
const suggestStatus = document.getElementById("suggest-status");

let expandedId = null;
let unsubscribeReactions = null;
let latestSongs = [];

function extractYoutubeId(input) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/(?:youtu\.be\/|v=|embed\/)([a-zA-Z0-9_-]{11})/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

async function seedSongsIfNeeded() {
  for (const song of SEED_SONGS) {
    const ref = doc(db, "songs", song.id);
    await setDoc(
      ref,
      {
        title: song.title,
        artist: song.artist,
        youtubeId: song.youtubeId,
        note: song.note,
        suggested: false,
        createdAt: serverTimestamp()
      },
      { merge: true }
    );
  }
}

function songCardHtml(id, data) {
  const counts = data.counts || {};
  const isExpanded = expandedId === id;
  const badge = data.suggested
    ? `<span class="badge">🎤 suggested by chat${data.by ? " · " + escapeHtml(data.by) : ""}</span>`
    : "";

  return `
    <article class="song-card ${isExpanded ? "expanded" : ""}" data-id="${id}">
      <button class="song-header" data-toggle="${id}">
        <img class="thumb" src="https://img.youtube.com/vi/${data.youtubeId}/mqdefault.jpg" alt="" loading="lazy" />
        <div class="song-meta">
          <h3>${escapeHtml(data.title)}</h3>
          <p class="artist">${escapeHtml(data.artist)}</p>
          ${badge}
        </div>
        <span class="chevron">${isExpanded ? "▲" : "▼"}</span>
      </button>

      ${data.note ? `<p class="note">💬 ${escapeHtml(data.note)}</p>` : ""}

      <div class="emoji-row">
        ${EMOJIS.map(
          (e) => `<button class="emoji-btn" data-emoji="${e}" data-id="${id}">${e} <span class="count">${counts[e] || 0}</span></button>`
        ).join("")}
      </div>

      ${
        isExpanded
          ? `
        <div class="song-expanded">
          <div class="video-wrap">
            <iframe src="https://www.youtube.com/embed/${data.youtubeId}" title="${escapeHtml(data.title)}"
              frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
          </div>

          <form class="reaction-form" data-id="${id}">
            <input type="text" name="name" placeholder="Amit (or you, chat)" maxlength="40" />
            <textarea name="comment" placeholder="Your reaction after listening, make it funny..." maxlength="280" required></textarea>
            <button type="submit">React</button>
          </form>

          <div class="reactions-feed" id="reactions-${id}">
            <p class="loading">Loading reactions...</p>
          </div>
        </div>
      `
          : ""
      }
    </article>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function render(songs) {
  listEl.innerHTML = songs.map(({ id, data }) => songCardHtml(id, data)).join("");

  listEl.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleExpand(btn.dataset.toggle));
  });

  listEl.querySelectorAll(".emoji-btn").forEach((btn) => {
    btn.addEventListener("click", () => sendEmoji(btn.dataset.id, btn.dataset.emoji));
  });

  const form = listEl.querySelector(".reaction-form");
  if (form) {
    form.addEventListener("submit", onReactionSubmit);
  }

  if (expandedId) {
    watchReactions(expandedId);
  }
}

function toggleExpand(id) {
  expandedId = expandedId === id ? null : id;
  if (unsubscribeReactions) {
    unsubscribeReactions();
    unsubscribeReactions = null;
  }
  render(latestSongs);
}

function watchReactions(songId) {
  const feed = document.getElementById(`reactions-${songId}`);
  if (!feed) return;
  const reactionsCol = collection(db, "songs", songId, "reactions");
  unsubscribeReactions = onSnapshot(query(reactionsCol, orderBy("createdAt", "desc")), (snap) => {
    if (snap.empty) {
      feed.innerHTML = `<p class="empty">No one has reacted yet. Be the first.</p>`;
      return;
    }
    feed.innerHTML = snap.docs
      .map((d) => {
        const r = d.data();
        return `<div class="reaction-item">
          <strong>${escapeHtml(r.name || "Anonymous from chat")}</strong>
          <p>${escapeHtml(r.comment)}</p>
        </div>`;
      })
      .join("");
  });
}

async function sendEmoji(songId, emoji) {
  const ref = doc(db, "songs", songId);
  await updateDoc(ref, { [`counts.${emoji}`]: increment(1) });
}

async function onReactionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const songId = form.dataset.id;
  const name = form.name.value.trim().slice(0, 40);
  const comment = form.comment.value.trim().slice(0, 280);
  if (!comment) return;

  const reactionsCol = collection(db, "songs", songId, "reactions");
  await addDoc(reactionsCol, { name, comment, createdAt: serverTimestamp() });
  form.reset();
}

suggestForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const title = form.title.value.trim().slice(0, 100);
  const artist = form.artist.value.trim().slice(0, 100);
  const link = form.link.value.trim();
  const by = form.by.value.trim().slice(0, 40);

  const youtubeId = extractYoutubeId(link);
  if (!title || !artist || !youtubeId) {
    suggestStatus.textContent = "You need a title, an artist, and a valid YouTube link.";
    suggestStatus.className = "status error";
    return;
  }

  await addDoc(songsCol, {
    title,
    artist,
    youtubeId,
    note: "",
    suggested: true,
    by: by || null,
    createdAt: serverTimestamp()
  });

  suggestStatus.textContent = "Added to the list, thanks for the suggestion!";
  suggestStatus.className = "status success";
  form.reset();
});

async function init() {
  await seedSongsIfNeeded();
  onSnapshot(query(songsCol, orderBy("createdAt", "asc")), (snap) => {
    latestSongs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    render(latestSongs);
  });
}

init();
