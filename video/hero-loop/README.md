# Homepage hero loop

The 18.4-second silent loop in the homepage hero. It is drawn in HTML and rendered to video, so it plays the same everywhere.

It plays beside the page's headline, so it has no captions, chapter titles or end card, and nothing in it is headline-sized. It shows the product at its own scale and loops straight back to the start.

| Time | Scene |
|---|---|
| 0–11.1s | Work: a merged ticket shows what it cost ($6,930), then the next feature is estimated from the people assigned to it (about $5,400), the estimate sits on its card and the card moves to In progress |
| 11.1–13.6s | Forecast: $14,180 spent in ten days, $42,540 by month end |
| 13.6–15.8s | See: Priya at 97% of her weekly Claude limit, Elena at 6% |
| 15.8–18.4s | Never collected: the agent reads usage locally |

The figures are the homepage's example team (Northwind Labs, 38 people). Keep them in step with the homepage sections.

## Files

- `hero-loop.html` is the source. Asset placeholders such as `{{f0}}` are filled at render time. The scene timings are in `S` at the top of the script.
- `render.mjs` fills in the assets, steps the page frame by frame in Chromium and encodes the result.
- `assets/` holds the Cal Sans display font and the four example people's photos. Tool logos come from `apps/admin/public`.

## Render

```sh
node video/hero-loop/render.mjs            # writes apps/admin/public/video/hero-loop*
node video/hero-loop/render.mjs --preview  # writes a self-contained preview page you can open and scrub
```

It needs ffmpeg with libx264 and libvpx-vp9, and network access for the DM Sans and JetBrains Mono web fonts. If the fonts do not load, it stops instead of rendering in a fallback font.

## Before reusing the photos

The four portraits in `assets/people/` are placeholders from randomuser.me, chosen for the mock-up. Replace them with photos you have the rights to, then re-render.
