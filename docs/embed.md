# Embedding

Any Kwami can live on any site. It stays connected to its real pot, updates as that pot changes, and links back to its arena page.

## Iframe

```html
<iframe
  src="https://x.kwami.io/embed/<MINT>"
  width="360" height="360"
  frameborder="0" allowtransparency="true"
  title="Kwami"></iframe>
```

## Loader script

For several Kwamis on one page, or when you would rather not hand-write markup:

```html
<div data-kwami="<MINT>" data-size="320"></div>
<script src="https://x.kwami.io/embed.js" async></script>
```

The loader is dependency-free, framework-free and under 2KB. It runs on someone else's page, so it assumes nothing about the host: no build step, no module loader, and no guarantee that anything else on the page is well behaved. It also keeps a `MutationObserver` running, because host pages routinely render their content *after* third-party scripts execute.

## Options

| Attribute | Query param | Effect |
|---|---|---|
| `data-size` | — | Square size in pixels (default 320) |
| `data-chrome="off"` | `chrome=off` | Hides the name and pot overlay |
| `data-interactive="off"` | `interactive=off` | Removes the "Challenge" link |
| `data-color-a` | `colorA` | Override the primary colour (hex, no `#`) |
| `data-color-b` | `colorB` | Override the accent colour |

Colour overrides let a host retint a Kwami to match its own design without losing the silhouette that makes it recognisable.

## Design notes

**The embed has no background.** The host page's own surface shows through, which is what makes it feel native rather than pasted on. The `embed` layout also strips the ambient gradient globally, since it would otherwise show as a purple haze inside a light host page.

**It is never completely still.** A slow idle breathing cycle runs even with no audio. Static 3D on someone else's page reads as a broken canvas.

**Frame headers.** `/embed/**` opts out of the global `X-Frame-Options` lockdown in `nuxt.config.ts`. Every other route stays locked down.

## Messages

The embed posts to its parent once ready:

```js
window.addEventListener('message', (e) => {
  if (e.data?.type === 'kwami:ready') {
    console.log('mounted', e.data.mint)
  }
})
```

Always check `e.origin` before acting on a message. The embed does not currently accept inbound messages.

## Wallets and marketplaces get it for free

The embed is not only for sites that choose to add one. Every Kwami's NFT metadata sets `animation_url` to its embed URL, so Phantom, Magic Eden, Tensor and anything else that follows the Metaplex schema renders the **live** Kwami — current pot, current vitality — wherever the token appears. Nobody has to integrate anything.

## Using the renderer directly

For a native app or a custom canvas, `app/utils/kwami-renderer.ts` is self-contained and depends only on Three.js:

```ts
import { mountKwami } from '~/utils/kwami-renderer'

const handle = mountKwami(canvas, {
  renderer: 'crystal-ball',
  colorA: '#7c5cff',
  colorB: '#3ddc97',
  vitality: 0.8,
})

handle.setAudioLevel(0.4)  // call at 60fps; it smooths internally
handle.setArousal(0.9)
handle.dispose()
```

It returns a handle rather than a reactive object on purpose: audio level updates ~50 times a second, and pushing that through Vue's reactivity would schedule a component update per frame for a value only the GPU ever reads.
