/* CatTrack — app logic */

'use strict';

// ---------- Config ----------

const SUPABASE_URL = 'https://ckgeknxtjdwjsqqbmybg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bvUKm6IoPTXCKe81EfJ5cg_tcHbkGL4';
const APP_PASSWORD = 'CATTRACK2026';
const PHOTO_BUCKET = 'cat-photos';

// Each friend claims a number.
const PROFILES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];

// Campus locations — must match the values used in the cats table.
const BUILDING_GROUPS = [
  { label: 'A Dorms', items: ['A Dorms', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'] },
  { label: 'B Dorms', items: ['B Dorms', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13'] },
  { label: 'Lojman', items: ['A-B Lojman', 'D-E Lojman', 'E Lojman', 'F-G Lojman', 'Lojman'] },
  { label: 'Campus', items: ['FASS', 'FENS', 'FMAN', 'SBS', 'UC', 'IC', 'Piazza', 'Göl (Lake)', 'SGM', 'Pizzabulls', 'Post Office', 'Medline', 'SUSAM', 'Haberleşme', 'Korsan', 'Köpüklü', 'Other'] },
];

// Life status — separate from `is_wanted` (which flags urgency, not life stage).
const STATUS_META = {
  vet: { label: 'At the vet', badgeClass: 'badge-vet' },
  adopted: { label: 'Adopted', badgeClass: 'badge-adopted' },
  deceased: { label: 'In loving memory', badgeClass: 'badge-deceased' },
};

// Spay/neuter status — tri-state; `is_fixed` is null/undefined when unknown.
const FIXED_META = {
  true: { label: 'Fixed', badgeClass: 'badge-fixed' },
  false: { label: 'Not fixed', badgeClass: 'badge-notfixed' },
};

const LS_UNLOCKED = 'cattrack:unlocked';
const LS_NAME = 'cattrack:name';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- State ----------

let cats = [];            // all cats, newest first
let trackedIds = new Set(); // cat ids tracked by the current profile name
let userName = localStorage.getItem(LS_NAME) || '';
let editingId = null;     // cat id when the form is in edit mode

// ---------- DOM helpers ----------

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (isNaN(mins) || mins < 0) return fmtDateTime(iso);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} d ago`;
  return fmtDateTime(iso);
}

// ---------- Gates (password + profile picker) ----------

function openProfilePicker() {
  $('profile-list').innerHTML = PROFILES.map((p) => `
    <button type="button" class="profile-chip ${p === userName ? 'is-active' : ''}" data-name="${esc(p)}">
      ${esc(p)}
    </button>
  `).join('');
  $('profile-cancel').classList.toggle('hidden', !userName);
  $('profile-cancel-name').textContent = userName;
  $('name-gate').classList.remove('hidden');
}

function selectProfile(name) {
  const changed = name !== userName;
  userName = name;
  localStorage.setItem(LS_NAME, name);
  $('name-gate').classList.add('hidden');
  if (!appStarted) {
    startApp();
  } else if (changed) {
    $('profile-name').textContent = name;
    loadTracked().then(render).catch(console.error);
    toast(`Hi, ${name}.`);
  }
}

function initGates() {
  const unlocked = localStorage.getItem(LS_UNLOCKED) === 'yes';
  if (!unlocked) {
    $('gate').classList.remove('hidden');
    $('gate-password').focus();
  } else if (!userName) {
    openProfilePicker();
  } else {
    startApp();
  }

  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('gate-password').value === APP_PASSWORD) {
      localStorage.setItem(LS_UNLOCKED, 'yes');
      $('gate').classList.add('hidden');
      if (!userName) {
        openProfilePicker();
      } else {
        startApp();
      }
    } else {
      $('gate-error').classList.remove('hidden');
      $('gate-password').select();
    }
  });

  $('profile-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-name]');
    if (btn) selectProfile(btn.dataset.name);
  });

  $('profile-cancel').addEventListener('click', () => {
    $('name-gate').classList.add('hidden');
  });

  $('profile-btn').addEventListener('click', openProfilePicker);
}

// ---------- Data ----------

async function loadCats() {
  const { data, error } = await db
    .from('cats')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  cats = data || [];
}

async function loadTracked() {
  const { data, error } = await db
    .from('tracked_cats')
    .select('cat_id')
    .eq('user_name', userName);
  if (error) throw error;
  trackedIds = new Set((data || []).map((r) => r.cat_id));
}

async function refresh() {
  const status = $('list-status');
  status.textContent = 'Loading cats…';
  status.classList.remove('hidden');
  try {
    await Promise.all([loadCats(), loadTracked()]);
    status.classList.add('hidden');
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not load cats. Check your connection and reload.';
  }
  render();
}

// ---------- Rendering ----------

// Photo URLs inside notes are shown as short links.
function notesHtml(notes) {
  let n = 0;
  return esc(notes).replace(/https?:\/\/\S+/g, (u) =>
    `<a href="${u}" target="_blank" rel="noopener" class="note-link">photo ${++n}</a>`);
}

// `last_seen_at` / `last_seen_place` track sightings; `building` is where the
// cat usually lives. Cats never marked as seen fall back to their report info.
const lastSeenAt = (cat) => cat.last_seen_at || cat.created_at;
const lastSeenPlace = (cat) => cat.last_seen_place || cat.building || 'campus';

function statusBadgeHtml(cat) {
  const meta = STATUS_META[cat.status];
  return meta ? `<span class="badge ${meta.badgeClass}">${esc(meta.label)}</span>` : '';
}

function fixedBadgeHtml(cat) {
  if (cat.is_fixed === null || cat.is_fixed === undefined) return '';
  const meta = FIXED_META[cat.is_fixed];
  return meta ? `<span class="badge ${meta.badgeClass}">${esc(meta.label)}</span>` : '';
}

function photoHtml(cat, cls) {
  if (cat.photo_url) {
    return `<img class="${cls}" src="${esc(cat.photo_url)}" alt="Photo of ${esc(cat.name || 'a cat')}" loading="lazy">`;
  }
  return `<div class="photo-fallback" aria-hidden="true">·ᴥ·</div>`;
}

// Broken images fall back to the flat placeholder. Capture phase — img error
// events don't bubble, and inline onerror is blocked by the CSP.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.id === 'm-photo') { img.classList.add('hidden'); return; }
  if (img.closest('.cat-card, .tracked-card')) {
    const div = document.createElement('div');
    div.className = 'photo-fallback';
    div.setAttribute('aria-hidden', 'true');
    div.textContent = '·ᴥ·';
    img.replaceWith(div);
  }
}, true);

function miniCardHtml(cat, { showWantedBadge = true } = {}) {
  return `
    <article class="tracked-card" data-id="${esc(cat.id)}">
      ${photoHtml(cat, '')}
      <div class="p-2.5">
        <p class="text-sm font-medium truncate">${esc(cat.name || 'Unnamed cat')}</p>
        <p class="text-xs text-ink-3 truncate mb-1.5">${esc(cat.building || '—')}</p>
        <div class="flex flex-wrap gap-1">
          ${cat.last_seen_at
            ? `<span class="badge badge-seen">Seen ${esc(timeAgo(cat.last_seen_at))}</span>`
            : '<span class="badge badge-notseen">No sightings yet</span>'}
          ${statusBadgeHtml(cat)}
          ${showWantedBadge && cat.is_wanted ? '<span class="badge badge-wanted">Wanted</span>' : ''}
        </div>
      </div>
    </article>`;
}

function renderWanted() {
  const wantedCats = cats.filter((c) => c.is_wanted);
  $('wanted-section').classList.toggle('hidden', !wantedCats.length);
  $('wanted-count').textContent = wantedCats.length
    ? `${wantedCats.length} cat${wantedCats.length === 1 ? '' : 's'}`
    : '';
  $('wanted-row').innerHTML = wantedCats
    .map((cat) => miniCardHtml(cat, { showWantedBadge: false }))
    .join('');
}

function renderTracked() {
  const row = $('tracked-row');
  const trackedCats = cats.filter((c) => trackedIds.has(c.id));
  $('tracked-count').textContent = trackedCats.length
    ? `${trackedCats.length} cat${trackedCats.length === 1 ? '' : 's'}`
    : '';

  if (!trackedCats.length) {
    row.innerHTML = `
      <div class="w-full border border-dashed border-line-2 rounded px-4 py-6 text-center text-sm text-ink-3">
        Nothing tracked yet — tap “Track” on a cat below to keep an eye on it.
      </div>`;
    return;
  }

  row.innerHTML = trackedCats.map((cat) => miniCardHtml(cat)).join('');
}

function visibleCats() {
  const building = $('filter-building').value;
  const q = $('filter-search').value.trim().toLowerCase();
  const wantedOnly = $('filter-wanted').checked;
  const statusFilter = $('filter-status').value;
  const fixedFilter = $('filter-fixed').value;

  return cats.filter((c) => {
    if (building && c.building !== building) return false;
    if (q) {
      const haystack = [c.name, c.breed, c.description, c.notes]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (wantedOnly && !c.is_wanted) return false;
    if (statusFilter === 'active' && c.status) return false;
    if (statusFilter && statusFilter !== 'active' && c.status !== statusFilter) return false;
    if (fixedFilter === 'unknown' && (c.is_fixed !== null && c.is_fixed !== undefined)) return false;
    if (fixedFilter === 'true' && c.is_fixed !== true) return false;
    if (fixedFilter === 'false' && c.is_fixed !== false) return false;
    return true;
  });
}

function renderList() {
  const list = $('cat-list');
  const status = $('list-status');
  const items = visibleCats();

  if (!items.length && !status.textContent.startsWith('Could not')) {
    status.textContent = cats.length
      ? 'No cats match these filters.'
      : 'No cats logged yet. Be the first — add one above.';
    status.classList.remove('hidden');
  } else if (items.length) {
    status.classList.add('hidden');
  }

  list.innerHTML = items.map((cat) => {
    const tracked = trackedIds.has(cat.id);
    return `
    <article class="cat-card ${cat.is_wanted ? 'is-wanted' : ''} ${cat.status === 'adopted' ? 'is-adopted' : ''} ${cat.status === 'deceased' ? 'is-deceased' : ''}" data-id="${esc(cat.id)}">
      ${photoHtml(cat, 'photo')}
      <div class="p-4 flex flex-col gap-2 grow">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="font-semibold truncate">${esc(cat.name || 'Unnamed cat')}</h3>
            <p class="text-sm text-ink-2 truncate">
              ${esc(cat.building || 'Unknown building')}${cat.breed ? ` · ${esc(cat.breed)}` : ''}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          ${cat.last_seen_at
            ? `<span class="badge badge-seen">Seen in ${esc(lastSeenPlace(cat))} · ${esc(timeAgo(cat.last_seen_at))}</span>`
            : '<span class="badge badge-notseen">No sightings yet</span>'}
          ${statusBadgeHtml(cat)}
          ${fixedBadgeHtml(cat)}
          ${cat.is_wanted ? '<span class="badge badge-wanted">Wanted / missing</span>' : ''}
        </div>

        ${cat.description ? `<p class="text-sm text-ink-2">${esc(cat.description)}</p>` : ''}
        ${cat.notes ? `<p class="text-sm text-ink-3">${notesHtml(cat.notes)}</p>` : ''}

        <p class="text-xs text-ink-3 mt-auto pt-1">
          Reported by ${esc(cat.reported_by || 'someone')}${cat.created_at ? ` · ${timeAgo(cat.created_at)}` : ''}
        </p>

        <div class="flex flex-wrap gap-1.5 pt-2 border-t border-line">
          <button class="card-action act-seen" data-act="seen">I saw it</button>
          <button class="card-action ${tracked ? 'is-active' : ''}" data-act="track">
            ${tracked ? '★ Tracked' : '☆ Track'}
          </button>
          <button class="card-action" data-act="edit">Edit</button>
          <button class="card-action danger" data-act="delete">Delete</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

function render() {
  $('profile-name').textContent = userName;
  renderWanted();
  renderTracked();
  renderList();
}

// ---------- Actions ----------

async function toggleTrack(cat) {
  const wasTracked = trackedIds.has(cat.id);
  try {
    if (wasTracked) {
      const { error } = await db
        .from('tracked_cats')
        .delete()
        .eq('cat_id', cat.id)
        .eq('user_name', userName);
      if (error) throw error;
      trackedIds.delete(cat.id);
    } else {
      const { error } = await db
        .from('tracked_cats')
        .insert({ cat_id: cat.id, user_name: userName });
      if (error) throw error;
      trackedIds.add(cat.id);
    }
    render();
  } catch (err) {
    console.error(err);
    toast('Could not update tracking. Try again.', true);
  }
}

// ---------- Sighting picker ----------

let seenCat = null;

function openSeenPicker(cat) {
  seenCat = cat;
  $('seen-title').textContent = `Where did you see ${cat.name || 'this cat'}?`;
  $('seen-place').innerHTML = buildingOptions();
  $('seen-place').value = cat.last_seen_place || cat.building || 'Other';
  $('seen-overlay').classList.remove('hidden');
  $('seen-sheet').classList.remove('hidden');
}

function closeSeenPicker() {
  $('seen-overlay').classList.add('hidden');
  $('seen-sheet').classList.add('hidden');
  seenCat = null;
}

async function confirmSeen() {
  const cat = seenCat;
  if (!cat) return;
  const patch = {
    last_seen_at: new Date().toISOString(),
    last_seen_place: $('seen-place').value,
  };
  try {
    const { error } = await db.from('cats').update(patch).eq('id', cat.id);
    if (error) throw error;
    Object.assign(cat, patch);
    closeSeenPicker();
    render();
    if (modalCat === cat) {
      setModalSeenBadge(cat);
      renderSightings(cat.id);
    }
    toast(`${cat.name || 'Cat'} seen in ${patch.last_seen_place}.`);
  } catch (err) {
    console.error(err);
    toast('Could not save the sighting. Try again.', true);
    return;
  }

  // Best-effort history entry — doesn't block the core "seen" flow above,
  // so it fails soft if the `sightings` table hasn't been migrated in yet.
  try {
    const { error: sightingErr } = await db.from('sightings').insert({
      cat_id: cat.id,
      place: patch.last_seen_place,
      seen_at: patch.last_seen_at,
      reported_by: userName,
    });
    if (sightingErr) throw sightingErr;
  } catch (err) {
    console.error('Could not record sighting history:', err);
  }
}

// ---------- Sighting history ----------

async function loadSightings(catId) {
  const { data, error } = await db
    .from('sightings')
    .select('*')
    .eq('cat_id', catId)
    .order('seen_at', { ascending: false });
  if (error) {
    console.error('Could not load sighting history:', error);
    return [];
  }
  return data || [];
}

function sightingsHtml(sightings) {
  if (!sightings.length) return '<p class="text-ink-3">No sightings logged yet.</p>';
  return sightings.map((s) => `
    <p>${esc(s.place)}
      <span class="text-ink-3">· ${esc(timeAgo(s.seen_at))}${s.reported_by ? ` · reported by ${esc(s.reported_by)}` : ''}</span>
    </p>`).join('');
}

async function renderSightings(catId) {
  $('m-sightings').innerHTML = '<p class="text-ink-3">Loading…</p>';
  const sightings = await loadSightings(catId);
  if (modalCat && modalCat.id === catId) {
    $('m-sightings').innerHTML = sightingsHtml(sightings);
  }
}

async function deleteCat(cat) {
  const label = cat.name ? `“${cat.name}”` : 'this cat';
  if (!confirm(`Delete ${label} from the log? This can't be undone.`)) return;
  try {
    // Remove tracking rows first so no orphans are left behind.
    await db.from('tracked_cats').delete().eq('cat_id', cat.id);
    const { error } = await db.from('cats').delete().eq('id', cat.id);
    if (error) throw error;
    cats = cats.filter((c) => c.id !== cat.id);
    trackedIds.delete(cat.id);
    render();
    toast('Cat deleted.');
  } catch (err) {
    console.error(err);
    toast('Could not delete the cat.', true);
  }
}

// ---------- Cat profile modal ----------

let modalCat = null;

function catPhotos(cat) {
  const urls = cat.photo_url ? [cat.photo_url] : [];
  const extra = (cat.notes || '').match(/https?:\/\/\S+/g);
  if (extra) urls.push(...extra);
  return urls;
}

// Notes without the "More photos: <url> …" tail (shown as a gallery instead).
function notesTextOnly(notes) {
  if (!notes) return '';
  return notes.replace(/More photos:.*$/s, '').replace(/https?:\/\/\S+/g, '').trim();
}

function setModalPhoto(photos, idx) {
  $('m-photo').src = photos[idx];
  document.querySelectorAll('.modal-thumb').forEach((t) => {
    t.classList.toggle('is-active', Number(t.dataset.idx) === idx);
  });
}

function setModalSeenBadge(cat) {
  const el = $('m-lastseen');
  el.classList.toggle('is-empty', !cat.last_seen_at);
  if (!cat.last_seen_at) {
    el.innerHTML = `No sightings yet <small>reported ${esc(timeAgo(cat.created_at))}</small>`;
    return;
  }
  const seen = timeAgo(cat.last_seen_at);
  const exact = fmtDateTime(cat.last_seen_at);
  el.innerHTML =
    `Last seen in ${esc(lastSeenPlace(cat))} · ${esc(seen)}${seen === exact ? '' : ` <small>${esc(exact)}</small>`}`;
}

function updateModalTrackBtn() {
  const tracked = modalCat && trackedIds.has(modalCat.id);
  $('m-track').textContent = tracked ? '★ Tracked' : '☆ Track';
  $('m-track').classList.toggle('is-active', tracked);
}

function openCatModal(cat) {
  modalCat = cat;
  $('m-name').textContent = cat.name || 'Unnamed cat';

  const photos = catPhotos(cat);
  $('m-photo').classList.toggle('hidden', !photos.length);
  $('m-thumbs').innerHTML = photos.length > 1
    ? photos.map((u, i) =>
        `<img src="${esc(u)}" data-idx="${i}" class="modal-thumb ${i === 0 ? 'is-active' : ''}" alt="Photo ${i + 1}" loading="lazy">`
      ).join('')
    : '';
  if (photos.length) $('m-photo').src = photos[0];

  setModalSeenBadge(cat);
  const statusMeta = STATUS_META[cat.status];
  $('m-status').className = `badge ${statusMeta ? statusMeta.badgeClass : ''}`.trim();
  $('m-status').textContent = statusMeta ? statusMeta.label : '';
  $('m-status').classList.toggle('hidden', !statusMeta);
  const fixedMeta = FIXED_META[cat.is_fixed];
  $('m-fixed').className = `badge ${fixedMeta ? fixedMeta.badgeClass : ''}`.trim();
  $('m-fixed').textContent = fixedMeta ? fixedMeta.label : '';
  $('m-fixed').classList.toggle('hidden', !fixedMeta);
  $('m-wanted').classList.toggle('hidden', !cat.is_wanted);

  $('m-meta').textContent = [cat.building, cat.breed].filter(Boolean).join(' · ');
  const desc = cat.description || '';
  $('m-desc').textContent = desc;
  $('m-desc').classList.toggle('hidden', !desc);
  const notes = notesTextOnly(cat.notes);
  $('m-notes').textContent = notes;
  $('m-notes').classList.toggle('hidden', !notes);
  $('m-reporter').textContent = `Reported by ${cat.reported_by || 'someone'}`;
  updateModalTrackBtn();

  renderSightings(cat.id);
  renderComments(cat.id);

  $('modal-overlay').classList.remove('hidden');
  $('cat-modal').classList.remove('hidden');
  $('cat-modal').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeCatModal() {
  $('modal-overlay').classList.add('hidden');
  $('cat-modal').classList.add('hidden');
  document.body.style.overflow = '';
  modalCat = null;
}

// ---------- Comments (one level of replies) ----------

async function loadComments(catId) {
  const { data, error } = await db
    .from('comments')
    .select('*')
    .eq('cat_id', catId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Could not load comments:', error);
    return [];
  }
  return data || [];
}

function replyHtml(reply) {
  return `
    <div data-id="${esc(reply.id)}">
      <p class="text-sm"><span class="font-medium">${esc(reply.author || 'someone')}</span> <span class="text-ink-3 text-xs">${esc(timeAgo(reply.created_at))}</span></p>
      <p class="text-sm text-ink-2">${esc(reply.body)}</p>
      ${reply.author === userName
        ? `<button type="button" class="text-xs text-ink-3 hover:text-clay-2 underline underline-offset-2" data-comment-delete="${esc(reply.id)}">Delete</button>`
        : ''}
    </div>`;
}

function commentHtml(comment) {
  return `
    <div data-id="${esc(comment.id)}">
      <p class="text-sm"><span class="font-medium">${esc(comment.author || 'someone')}</span> <span class="text-ink-3 text-xs">${esc(timeAgo(comment.created_at))}</span></p>
      <p class="text-sm text-ink-2">${esc(comment.body)}</p>
      <div class="flex gap-3 mt-1">
        <button type="button" class="text-xs text-ink-3 hover:text-ink underline underline-offset-2" data-reply-toggle="${esc(comment.id)}">Reply</button>
        ${comment.author === userName
          ? `<button type="button" class="text-xs text-ink-3 hover:text-clay-2 underline underline-offset-2" data-comment-delete="${esc(comment.id)}">Delete</button>`
          : ''}
      </div>
      <form class="hidden mt-2 flex gap-2" data-reply-form="${esc(comment.id)}">
        <input type="text" class="field" placeholder="Write a reply…" maxlength="500" required>
        <button type="submit" class="btn-secondary shrink-0">Reply</button>
      </form>
      ${comment.replies.length
        ? `<div class="mt-2 pl-4 border-l border-line space-y-2">${comment.replies.map(replyHtml).join('')}</div>`
        : ''}
    </div>`;
}

function commentsHtml(comments) {
  const topLevel = comments.filter((c) => !c.parent_id).map((c) => ({
    ...c,
    replies: comments.filter((r) => r.parent_id === c.id),
  }));
  if (!topLevel.length) return '<p class="text-ink-3 text-sm">No comments yet.</p>';
  return `<div class="space-y-3">${topLevel.map(commentHtml).join('')}</div>`;
}

async function renderComments(catId) {
  $('m-comments').innerHTML = '<p class="text-ink-3 text-sm">Loading…</p>';
  const comments = await loadComments(catId);
  if (modalCat && modalCat.id === catId) {
    $('m-comments').innerHTML = commentsHtml(comments);
  }
}

async function postComment(catId, body, parentId = null) {
  const { error } = await db.from('comments').insert({
    cat_id: catId, parent_id: parentId, author: userName, body,
  });
  if (error) {
    console.error(error);
    toast('Could not post comment. Try again.', true);
    return false;
  }
  return true;
}

async function deleteComment(id) {
  const { error } = await db.from('comments').delete().eq('id', id);
  if (error) {
    console.error(error);
    toast('Could not delete comment.', true);
  }
}

// ---------- Add / edit form ----------

function openForm(cat = null) {
  editingId = cat ? cat.id : null;
  $('form-title').textContent = cat ? 'Edit cat' : 'Add a cat';
  $('form-submit').textContent = cat ? 'Save changes' : 'Save cat';
  $('form-error').classList.add('hidden');
  $('cat-form').reset();
  $('f-photo-name').textContent = '';
  $('f-photo-preview-wrap').classList.add('hidden');

  $('f-name').value = cat?.name || '';
  $('f-building').value = cat?.building || '';
  $('f-breed').value = cat?.breed || '';
  $('f-description').value = cat?.description || '';
  $('f-notes').value = cat?.notes || '';
  $('f-status').value = cat?.status || '';
  $('f-fixed').value = cat?.is_fixed === true ? 'true' : cat?.is_fixed === false ? 'false' : '';
  $('f-wanted').checked = !!cat?.is_wanted;

  // Keep old reporter names selectable even if no longer in PROFILES.
  const reporter = cat?.reported_by || userName;
  const repSel = $('f-reporter');
  if (reporter && ![...repSel.options].some((o) => o.value === reporter)) {
    repSel.insertAdjacentHTML('beforeend', `<option value="${esc(reporter)}">${esc(reporter)}</option>`);
  }
  repSel.value = reporter;

  if (cat?.photo_url) {
    $('f-photo-preview').src = cat.photo_url;
    $('f-photo-preview-wrap').classList.remove('hidden');
    $('f-photo-name').textContent = 'Current photo — choose a new one to replace it.';
  }

  $('form-overlay').classList.remove('hidden');
  $('form-sheet').classList.remove('hidden');
  $('form-sheet').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeForm() {
  $('form-overlay').classList.add('hidden');
  $('form-sheet').classList.add('hidden');
  document.body.style.overflow = '';
  editingId = null;
}

async function uploadPhoto(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;
  const { data } = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function submitForm(e) {
  e.preventDefault();
  const errEl = $('form-error');
  errEl.classList.add('hidden');

  const record = {
    name: $('f-name').value.trim() || null,
    building: $('f-building').value,
    breed: $('f-breed').value.trim() || null,
    description: $('f-description').value.trim() || null,
    notes: $('f-notes').value.trim() || null,
    status: $('f-status').value || null,
    is_fixed: $('f-fixed').value === '' ? null : $('f-fixed').value === 'true',
    is_wanted: $('f-wanted').checked,
    reported_by: $('f-reporter').value.trim() || userName,
  };

  if (!record.building) {
    errEl.textContent = 'Please pick a location.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = $('form-submit');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const file = $('f-photo').files[0];
    if (file) {
      try {
        record.photo_url = await uploadPhoto(file);
      } catch (err) {
        console.error(err);
        throw new Error('photo-upload');
      }
    }

    if (editingId) {
      const { data, error } = await db
        .from('cats').update(record).eq('id', editingId).select().single();
      if (error) throw error;
      const i = cats.findIndex((c) => c.id === editingId);
      if (i !== -1) cats[i] = data;
      toast('Cat updated.');
    } else {
      const { data, error } = await db
        .from('cats').insert(record).select().single();
      if (error) throw error;
      cats.unshift(data);
      toast('Cat added. Thanks!');
    }
    closeForm();
    render();
  } catch (err) {
    console.error(err);
    errEl.textContent = err.message === 'photo-upload'
      ? 'Could not upload the photo. Nothing was saved — remove the photo or try again.'
      : 'Could not save. Check your connection and try again.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? 'Save changes' : 'Save cat';
  }
}

// ---------- Wiring ----------

function buildingOptions() {
  return BUILDING_GROUPS.map((g) =>
    `<optgroup label="${esc(g.label)}">` +
    g.items.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('') +
    '</optgroup>'
  ).join('');
}

function fillSelects() {
  $('filter-building').innerHTML =
    '<option value="">All locations</option>' + buildingOptions();
  $('f-building').innerHTML =
    '<option value="" disabled selected>Choose a location…</option>' + buildingOptions();
  $('f-reporter').innerHTML =
    PROFILES.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
}

function initApp() {
  fillSelects();

  ['filter-building', 'filter-search', 'filter-wanted', 'filter-status', 'filter-fixed'].forEach((id) => {
    $(id).addEventListener('input', renderList);
  });

  $('add-btn').addEventListener('click', () => openForm());
  $('cat-form').addEventListener('submit', submitForm);

  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', closeForm);
  });
  document.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', closeCatModal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('seen-sheet').classList.contains('hidden')) closeSeenPicker();
    else if (!$('cat-modal').classList.contains('hidden')) closeCatModal();
    else if (!$('form-sheet').classList.contains('hidden')) closeForm();
  });

  // Modal internals
  $('m-thumbs').addEventListener('click', (e) => {
    const t = e.target.closest('.modal-thumb');
    if (t && modalCat) setModalPhoto(catPhotos(modalCat), Number(t.dataset.idx));
  });
  $('m-seen').addEventListener('click', () => {
    if (modalCat) openSeenPicker(modalCat);
  });
  $('seen-confirm').addEventListener('click', confirmSeen);
  document.querySelectorAll('[data-seen-cancel]').forEach((el) => {
    el.addEventListener('click', closeSeenPicker);
  });
  $('m-track').addEventListener('click', async () => {
    if (!modalCat) return;
    await toggleTrack(modalCat);
    updateModalTrackBtn();
  });
  $('m-edit').addEventListener('click', () => {
    const cat = modalCat;
    closeCatModal();
    if (cat) openForm(cat);
  });

  $('comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!modalCat) return;
    const input = $('comment-body');
    const body = input.value.trim();
    if (!body) return;
    const catId = modalCat.id;
    if (await postComment(catId, body)) {
      input.value = '';
      renderComments(catId);
    }
  });

  $('m-comments').addEventListener('click', (e) => {
    const replyBtn = e.target.closest('[data-reply-toggle]');
    if (replyBtn) {
      const form = $('m-comments').querySelector(`[data-reply-form="${replyBtn.dataset.replyToggle}"]`);
      if (form) form.classList.toggle('hidden');
      return;
    }
    const delBtn = e.target.closest('[data-comment-delete]');
    if (delBtn && modalCat) {
      if (!confirm('Delete this comment?')) return;
      const catId = modalCat.id;
      deleteComment(delBtn.dataset.commentDelete).then(() => renderComments(catId));
    }
  });

  $('m-comments').addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-reply-form]');
    if (!form || !modalCat) return;
    e.preventDefault();
    const input = form.querySelector('input');
    const body = input.value.trim();
    if (!body) return;
    const catId = modalCat.id;
    if (await postComment(catId, body, form.dataset.replyForm)) {
      renderComments(catId);
    }
  });

  // Tapping a wanted or tracked card opens the profile modal
  ['wanted-row', 'tracked-row'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      const cardId = e.target.closest('.tracked-card')?.dataset.id;
      const cat = cats.find((c) => c.id === cardId);
      if (cat) openCatModal(cat);
    });
  });

  $('f-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('f-photo-name').textContent = file.name;
    $('f-photo-preview').src = URL.createObjectURL(file);
    $('f-photo-preview-wrap').classList.remove('hidden');
  });

  // Card actions; tapping anywhere else on the card opens the modal.
  $('cat-list').addEventListener('click', (e) => {
    const card = e.target.closest('.cat-card');
    if (!card) return;
    const cat = cats.find((c) => c.id === card.dataset.id);
    if (!cat) return;
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      if (!e.target.closest('a')) openCatModal(cat);
      return;
    }
    switch (btn.dataset.act) {
      case 'seen': openSeenPicker(cat); break;
      case 'track': toggleTrack(cat); break;
      case 'edit': openForm(cat); break;
      case 'delete': deleteCat(cat); break;
    }
  });
}

let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;
  $('app').classList.remove('hidden');
  initApp();
  render();
  refresh();
}

// ---------- Boot ----------

initGates();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
