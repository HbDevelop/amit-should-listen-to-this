import { firebaseConfig } from "./firebase-config.js";
import { SEED_SONGS } from "./songs.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const EMOJIS = ["😍", "🔥", "😴", "🤯", "🤮"];
const WANT_KEY = "🙌";
const COMMENT_COUNT_KEY = "comments";
const POLL_INTERVAL_MS = 20000;
const MY_REACTIONS_KEY = "myReactions";

const FALLBACK_NOTES = [
  "Chat swears this one's a certified Amit classic. Trust the chat.",
  "If you don't know this one, that's exactly why we're here.",
  "Another gap in the Amit music encyclopedia, patched by the community.",
  "Mandatory listening. The chat has spoken.",
  "This one's non-negotiable, Amit. Press play."
];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const songsCol = collection(db, "songs");

const listEl = document.getElementById("song-list");
const suggestForm = document.getElementById("suggest-form");
const suggestStatus = document.getElementById("suggest-status");
const searchInput = document.getElementById("song-search");
const filterTabsEl = document.getElementById("filter-tabs");
const mainNavEl = document.getElementById("main-nav");
const modalOverlay = document.getElementById("song-modal");
const modalBody = document.getElementById("modal-body");
const modalCloseBtn = document.getElementById("modal-close");

let openSongId = null;
let latestSongs = [];
let activeSort = "popular";
let searchTerm = "";

function loadMyReactions() {
  try {
    return JSON.parse(localStorage.getItem(MY_REACTIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveMyReactions() {
  localStorage.setItem(MY_REACTIONS_KEY, JSON.stringify(myReactions));
}

let myReactions = loadMyReactions();

function extractYoutubeId(input) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/(?:youtu\.be\/|v=|embed\/)([a-zA-Z0-9_-]{11})/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

async function seedSongsIfNeeded() {
  // Security rules only allow *creating* songs from the client (not editing existing
  // ones, so random visitors can't rewrite the curated playlist) — so we only write
  // the seed songs that don't exist in Firestore yet, never touch existing docs.
  const existing = await getDocs(songsCol);
  const existingIds = new Set(existing.docs.map((d) => d.id));

  for (const song of SEED_SONGS) {
    if (existingIds.has(song.id)) continue;
    const ref = doc(db, "songs", song.id);
    await setDoc(ref, {
      title: song.title,
      artist: song.artist,
      youtubeId: song.youtubeId,
      note: song.note,
      suggested: false,
      createdAt: serverTimestamp()
    });
  }
}

function emojiRowHtml(id, counts) {
  return EMOJIS.map((e) => {
    const mine = myReactions[id] === e;
    const disabled = myReactions[id] && !mine;
    return `<button class="emoji-btn ${mine ? "selected" : ""} ${disabled ? "disabled" : ""}" data-emoji="${e}" data-id="${id}">${e} <span class="count">${counts[e] || 0}</span></button>`;
  }).join("");
}

function songCardHtml(id, data) {
  const counts = data.counts || {};
  const badge = data.suggested ? `<span class="badge">🎤 chat</span>` : "";
  const wantCount = counts[WANT_KEY] || 0;
  const wantBadge = wantCount > 0 ? `<span class="want-badge">🙌 +${wantCount}</span>` : "";
  const commentCount = counts[COMMENT_COUNT_KEY] || 0;
  const commentBadge = commentCount > 0 ? `<span class="comment-indicator">💬 ${commentCount}</span>` : "";
  const score = popularity(data);

  return `
    <button type="button" class="song-card" data-open="${id}">
      <div class="thumb-wrap">
        <img class="thumb" src="https://img.youtube.com/vi/${data.youtubeId}/mqdefault.jpg" alt="" loading="lazy" />
        ${score > 0 ? `<span class="score-badge">🔥 ${score}</span>` : ""}
      </div>
      <div class="song-meta">
        <h3>${escapeHtml(data.title)}</h3>
        <p class="artist">${escapeHtml(data.artist)}</p>
        <div class="mini-badges">${badge}${wantBadge}${commentBadge}</div>
      </div>
    </button>
  `;
}

function songDetailHtml(id, data) {
  const counts = data.counts || {};
  const badge = data.suggested
    ? `<span class="badge">🎤 suggested by chat${data.by ? " · " + escapeHtml(data.by) : ""}</span>`
    : "";
  const wantCount = counts[WANT_KEY] || 0;
  const wantBadge = wantCount > 0 ? `<span class="want-badge">🙌 +${wantCount} chat request${wantCount > 1 ? "s" : ""}</span>` : "";

  return `
    <h3>${escapeHtml(data.title)}</h3>
    <p class="artist">${escapeHtml(data.artist)}</p>
    <div class="mini-badges">${badge}${wantBadge}</div>

    ${data.note ? `<p class="note">💬 ${escapeHtml(data.note)}</p>` : ""}

    <div class="video-wrap">
      <iframe src="https://www.youtube.com/embed/${data.youtubeId}" title="${escapeHtml(data.title)}"
        frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
    </div>

    <div class="emoji-row">${emojiRowHtml(id, counts)}</div>
    ${myReactions[id] ? `<p class="reaction-hint">Click your reaction again to remove it.</p>` : ""}

    <form class="reaction-form" data-id="${id}">
      <input type="text" name="name" placeholder="Amit (or you, chat)" maxlength="40" />
      <textarea name="comment" placeholder="Your reaction after listening, make it funny..." maxlength="280" required></textarea>
      <button type="submit">React</button>
    </form>

    <div class="reactions-feed" id="reactions-${id}">
      <p class="loading">Loading reactions...</p>
    </div>
  `;
}

function timeAgo(date) {
  if (!date) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];
  for (const [name, secs] of units) {
    const value = Math.floor(seconds / secs);
    if (value >= 1) return `${value} ${name}${value > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function popularity(data) {
  const counts = data.counts || {};
  const reactions = EMOJIS.reduce((sum, e) => sum + (counts[e] || 0), 0);
  const comments = counts[COMMENT_COUNT_KEY] || 0;
  const wants = counts[WANT_KEY] || 0;
  return reactions + comments + wants;
}

function getVisibleSongs() {
  const term = searchTerm.trim().toLowerCase();

  const filtered = latestSongs.filter(({ data }) => {
    if (!term) return true;
    return data.title.toLowerCase().includes(term) || data.artist.toLowerCase().includes(term);
  });

  if (activeSort === "newest") {
    return filtered.slice().reverse();
  }
  return filtered.slice().sort((a, b) => popularity(b.data) - popularity(a.data));
}

function renderVisible() {
  render(getVisibleSongs());
  if (openSongId) refreshModal();
}

function render(songs) {
  listEl.innerHTML = songs.map(({ id, data }) => songCardHtml(id, data)).join("");
  listEl.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.open));
  });
}

function openModal(id) {
  openSongId = id;
  modalOverlay.classList.remove("hidden");
  refreshModal();
}

function closeModal() {
  openSongId = null;
  modalOverlay.classList.add("hidden");
  modalBody.innerHTML = "";
}

function refreshModal() {
  const entry = latestSongs.find((s) => s.id === openSongId);
  if (!entry) {
    closeModal();
    return;
  }
  modalBody.innerHTML = songDetailHtml(openSongId, entry.data);
  wireDetailEvents(openSongId);
  loadReactions(openSongId);
}

function wireDetailEvents(id) {
  modalBody.querySelectorAll(".emoji-btn").forEach((btn) => {
    btn.addEventListener("click", () => onEmojiClick(btn.dataset.id, btn.dataset.emoji));
  });
  const form = modalBody.querySelector(".reaction-form");
  if (form) {
    form.addEventListener("submit", onReactionSubmit);
  }
}

async function loadSongs() {
  try {
    const snap = await getDocs(query(songsCol, orderBy("createdAt", "asc")));
    latestSongs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderVisible();
  } catch (e) {
    console.error("loadSongs failed:", e.code, e.message);
    listEl.innerHTML = `<p class="empty">Could not load the playlist (${e.code || e.message}). Refresh to retry.</p>`;
  }
}

async function loadReactions(songId) {
  const feed = document.getElementById(`reactions-${songId}`);
  if (!feed) return;
  try {
    const reactionsCol = collection(db, "songs", songId, "reactions");
    const snap = await getDocs(query(reactionsCol, orderBy("createdAt", "desc")));
    if (snap.empty) {
      feed.innerHTML = `<p class="empty">No one has reacted yet. Be the first.</p>`;
      return;
    }
    feed.innerHTML = snap.docs
      .map((d) => {
        const r = d.data();
        const date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
        return `<div class="reaction-item">
          <div class="reaction-item-header">
            <strong>${escapeHtml(r.name || "Anonymous from chat")}</strong>
            <span class="reaction-time">${timeAgo(date)}</span>
          </div>
          <p>${escapeHtml(r.comment)}</p>
        </div>`;
      })
      .join("");
  } catch (e) {
    console.error("loadReactions failed:", e.code, e.message);
    feed.innerHTML = `<p class="empty">Could not load reactions (${e.code || e.message}).</p>`;
  }
}

async function onEmojiClick(songId, emoji) {
  const current = myReactions[songId];
  if (current && current !== emoji) return; // must remove the current one first

  const ref = doc(db, "songs", songId);
  if (current === emoji) {
    await updateDoc(ref, { [`counts.${emoji}`]: increment(-1) });
    delete myReactions[songId];
  } else {
    await updateDoc(ref, { [`counts.${emoji}`]: increment(1) });
    myReactions[songId] = emoji;
  }
  saveMyReactions();
  await loadSongs();
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
  await updateDoc(doc(db, "songs", songId), { [`counts.${COMMENT_COUNT_KEY}`]: increment(1) });
  form.reset();
  await loadSongs(); // re-renders the modal, which reloads its reactions feed too
}

suggestForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const title = form.title.value.trim().slice(0, 100);
  const artist = form.artist.value.trim().slice(0, 100);
  const link = form.link.value.trim();
  const by = form.by.value.trim().slice(0, 40);
  const note = form.note.value.trim().slice(0, 200);

  const youtubeId = extractYoutubeId(link);
  if (!title || !artist || !youtubeId) {
    suggestStatus.textContent = "You need a title, an artist, and a valid YouTube link.";
    suggestStatus.className = "status error";
    return;
  }

  const duplicate = latestSongs.find(({ data }) => data.youtubeId === youtubeId);
  if (duplicate) {
    await updateDoc(doc(db, "songs", duplicate.id), { [`counts.${WANT_KEY}`]: increment(1) });
    suggestStatus.textContent = "Already on the list — bumped the chat demand instead! 🙌";
    suggestStatus.className = "status success";
    form.reset();
    await loadSongs();
    return;
  }

  await addDoc(songsCol, {
    title,
    artist,
    youtubeId,
    note: note || FALLBACK_NOTES[Math.floor(Math.random() * FALLBACK_NOTES.length)],
    suggested: true,
    by: by || null,
    createdAt: serverTimestamp()
  });

  suggestStatus.textContent = "Added to the list, thanks for the suggestion!";
  suggestStatus.className = "status success";
  form.reset();
  await loadSongs();
});

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value;
  renderVisible();
});

filterTabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-tab");
  if (!btn) return;
  activeSort = btn.dataset.sort;
  filterTabsEl.querySelectorAll(".filter-tab").forEach((t) => t.classList.toggle("active", t === btn));
  renderVisible();
});

mainNavEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-tab");
  if (!btn) return;
  const page = btn.dataset.page;
  mainNavEl.querySelectorAll(".nav-tab").forEach((t) => t.classList.toggle("active", t === btn));
  document.getElementById("page-playlist").classList.toggle("hidden", page !== "playlist");
  document.getElementById("page-suggest").classList.toggle("hidden", page !== "suggest");
  closeModal();
});

modalCloseBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

async function init() {
  try {
    await seedSongsIfNeeded();
  } catch (e) {
    console.error("seedSongsIfNeeded failed:", e.code, e.message);
  }

  await loadSongs();
  setInterval(loadSongs, POLL_INTERVAL_MS);
}

init();
