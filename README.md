# CatTrack

> A shared log of the campus cats of **Sabancı University**.

Built by and for a small group of volunteers who look after the cats on
campus. Log a cat with a photo, see where it usually lives, record
sightings ("last seen in FASS, 2 h ago"), and track your favourites.

**Live:** https://rrafet.github.io/CatTrack/

## Stack

- Plain HTML / CSS / vanilla JavaScript — no build step
- [Tailwind CSS](https://tailwindcss.com) via Play CDN (pinned), custom muted palette in `tw-config.js`
- [Supabase](https://supabase.com) for data (`cats`, `tracked_cats` tables) and photo storage (`cat-photos` bucket)
- PWA: `manifest.json` + `sw.js` so it installs to the home screen

## How it works

- A group password unlocks the app (client-side gate, not real auth — the
  Supabase anon key is public by design and the tables are open to it).
- Everyone picks a profile name once; it's stored in localStorage and used
  for `reported_by` and personal cat tracking.
- **Seen now** logs a sighting: it asks where you saw the cat and stores
  it in `last_seen_at` / `last_seen_place`. This is separate from
  `building`, which is where the cat usually lives (and what the location
  filter uses). Cats never marked as seen fall back to their report time
  and home location.

## Configuration

All in `app.js`:

| Constant | What it is |
|---|---|
| `APP_PASSWORD` | the group password |
| `PROFILES` | the fixed list of usernames shown in the profile picker |
| `BUILDING_GROUPS` | campus locations for the dropdown/filter |

## Development

Serve the folder with any static server and open it:

```
python3 -m http.server 8000
```

Deploys automatically via GitHub Pages on every push to `main`.
