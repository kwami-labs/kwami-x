/**
 * Kwami embed loader.
 *
 * The iframe route works on its own; this exists for the case where a host
 * wants several Kwamis on a page and does not want to hand-write markup or
 * guess at sizing.
 *
 * Usage:
 *   <div data-kwami="<mint>" data-size="320"></div>
 *   <script src="https://x.kwami.io/embed.js" async></script>
 *
 * Deliberately dependency-free, framework-free and under 2KB: it runs on
 * someone else's page, so it must not assume a build step, a module loader, or
 * that anything else on that page is well behaved.
 */
;(function () {
  'use strict'

  var ORIGIN = (function () {
    var script = document.currentScript
    if (!script) return 'https://x.kwami.io'
    try {
      return new URL(script.src).origin
    } catch (e) {
      return 'https://x.kwami.io'
    }
  })()

  function mount(el) {
    if (el.getAttribute('data-kwami-mounted') === '1') return
    el.setAttribute('data-kwami-mounted', '1')

    var mint = el.getAttribute('data-kwami')
    if (!mint) return

    var size = parseInt(el.getAttribute('data-size') || '320', 10)
    var params = []
    if (el.getAttribute('data-chrome') === 'off') params.push('chrome=off')
    if (el.getAttribute('data-interactive') === 'off') params.push('interactive=off')
    var colorA = el.getAttribute('data-color-a')
    var colorB = el.getAttribute('data-color-b')
    if (colorA) params.push('colorA=' + encodeURIComponent(colorA.replace('#', '')))
    if (colorB) params.push('colorB=' + encodeURIComponent(colorB.replace('#', '')))

    var frame = document.createElement('iframe')
    frame.src = ORIGIN + '/embed/' + encodeURIComponent(mint) + (params.length ? '?' + params.join('&') : '')
    frame.width = String(size)
    frame.height = String(size)
    frame.setAttribute('frameborder', '0')
    frame.setAttribute('scrolling', 'no')
    frame.setAttribute('allowtransparency', 'true')
    frame.setAttribute('loading', 'lazy')
    frame.setAttribute('title', 'Kwami ' + mint)
    frame.style.border = '0'
    frame.style.colorScheme = 'normal'
    frame.style.background = 'transparent'
    frame.style.maxWidth = '100%'

    el.appendChild(frame)
  }

  function scan() {
    var nodes = document.querySelectorAll('[data-kwami]')
    for (var i = 0; i < nodes.length; i++) mount(nodes[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan)
  } else {
    scan()
  }

  // Host pages routinely render their content after this script runs, so keep
  // watching rather than scanning once and giving up.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true })
  }

  window.Kwami = { mount: mount, scan: scan, origin: ORIGIN }
})()
