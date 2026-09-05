<script setup lang="ts">
import type { KwamiDetailResponse } from '#shared/types/api'
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ownerActionIx } from '#shared/solana/instructions'

definePageMeta({ title: 'Manage' })

const route = useRoute()
const mint = computed(() => route.params.mint as string)
const { data, refresh } = await useFetch<KwamiDetailResponse>(`/api/kwami/${mint.value}`)
const kwami = computed(() => data.value?.kwami ?? null)

const wallet = useWalletStore()
const config = useRuntimeConfig()

const busy = ref(false)
const error = ref<string | null>(null)
const signature = ref<string | null>(null)

const isOwner = computed(() => wallet.address && kwami.value?.owner_wallet === wallet.address)
const canPublish = computed(() => kwami.value && ['minted', 'paused'].includes(kwami.value.state))
const canPause = computed(() => kwami.value?.state === 'live')

async function act(action: 'publish' | 'pause') {
  if (!wallet.publicKey || !kwami.value) return
  busy.value = true
  error.value = null
  try {
    const program = new PublicKey(config.public.kwamiProgramId as string)
    const ix = await ownerActionIx(action, new PublicKey(kwami.value.mint), wallet.publicKey, program)

    const connection = wallet.rpc()
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message(),
    )

    const sig = await wallet.signAndSend(tx)
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    signature.value = sig
    await refresh()
  } catch (e) {
    error.value = describeWalletError(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="wrap manage">
    <header class="stack gap-1">
      <NuxtLink :to="`/kwami/${mint}`" class="dim">← {{ kwami?.name ?? 'Kwami' }}</NuxtLink>
      <h1>Manage</h1>
    </header>

    <div v-if="!isOwner" class="card">
      <p class="muted">You do not hold this Kwami.</p>
    </div>

    <template v-else>
      <div class="card stack gap-3">
        <div class="stack gap-1">
          <span class="eyebrow">State</span>
          <span class="badge" :class="`badge--${kwami?.state}`">{{ kwami?.state }}</span>
        </div>

        <p class="muted">
          Publishing opens it to challengers. Pausing stops new tickets — sessions already running still
          settle normally, and the pot is untouched either way.
        </p>

        <div class="row gap-2">
          <button v-if="canPublish" class="btn btn--primary" :disabled="busy" @click="act('publish')">
            {{ busy ? 'Confirming…' : 'Publish' }}
          </button>
          <button v-if="canPause" class="btn" :disabled="busy" @click="act('pause')">
            {{ busy ? 'Confirming…' : 'Pause' }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="signature" class="hint num wrap-anywhere">{{ signature }}</p>
      </div>

      <div class="card stack gap-2">
        <h3>What you cannot change</h3>
        <p class="muted">
          The secret, both ticket prices, the session length, the payout split and the resolution mode were
          written to the chain at mint and have no setter. That is the point — a challenger who reads the
          rules before paying is guaranteed those are the rules that settle their session.
        </p>
      </div>

      <div class="card stack gap-2">
        <h3>Withdrawing</h3>
        <p class="muted">
          The pot can only be withdrawn while the Kwami is unpublished, paused, cracked or dead. A live
          Kwami's pot belongs to the game — letting an owner drain it mid-session would make every ticket a
          scam.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.manage {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 620px;
}
</style>
