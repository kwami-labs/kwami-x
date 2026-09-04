<script setup lang="ts">
const route = useRoute()

const nav = [
  { to: '/', label: 'Arena' },
  { to: '/mint', label: 'Mint' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/docs', label: 'Docs' },
]

const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
</script>

<template>
  <div class="shell">
    <header class="header">
      <div class="wrap header__inner">
        <NuxtLink to="/" class="brand">
          <KwamiMark />
          <span class="brand__word">kwami</span>
          <span class="badge badge--gold brand__ver">v3</span>
        </NuxtLink>

        <nav class="nav">
          <NuxtLink v-for="item in nav" :key="item.to" :to="item.to" class="nav__link" :class="{ 'nav__link--on': isActive(item.to) }">
            {{ item.label }}
          </NuxtLink>
        </nav>

        <WalletButton />
      </div>
    </header>

    <main class="main">
      <slot />
    </main>

    <footer class="footer">
      <div class="wrap footer__inner">
        <span class="dim">Kwami v3 — three minutes, your voice, their secret.</span>
        <div class="row gap-3">
          <NuxtLink to="/docs" class="dim">Docs</NuxtLink>
          <NuxtLink to="/docs/embed" class="dim">Embed</NuxtLink>
          <a href="https://github.com/kwami-labs/kwami-x" target="_blank" rel="noopener" class="dim">GitHub</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 50;
  height: var(--header-h);
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: rgba(7, 8, 12, 0.72);
  backdrop-filter: blur(18px) saturate(140%);
}

.header__inner {
  display: flex;
  align-items: center;
  gap: 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 640;
  letter-spacing: -0.02em;
  font-size: 1.05rem;
}

.brand__word { color: var(--fg); }
.brand__ver { font-size: 0.68rem; padding: 1px 7px; }

.nav {
  display: flex;
  gap: 4px;
  flex: 1;
}

.nav__link {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 0.92rem;
  color: var(--fg-muted);
  transition: color 0.15s ease, background 0.15s ease;
}

.nav__link:hover { color: var(--fg); background: var(--panel); }
.nav__link--on { color: var(--fg); background: var(--panel-strong); }

.main { flex: 1; padding-block: 40px 80px; }

.footer {
  border-top: 1px solid var(--border);
  padding-block: 22px;
  font-size: 0.85rem;
}

.footer__inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

@media (max-width: 760px) {
  .nav { display: none; }
}
</style>
