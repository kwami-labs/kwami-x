import { normalizeHandle, validateProfile, type ProfileDraft } from '#shared/auth/profile'

/**
 * Read and write the signed-in account's public profile.
 *
 * Straight to `profiles` through the browser client, with no `/api/me/profile`
 * in between: the table's row level security already says exactly what this
 * needs — anyone may read a profile, only its owner may write it — so a server
 * route would be a second copy of that rule, able to disagree with the first.
 *
 * The handle matters beyond decoration. Every Kwami card and detail page
 * already renders `author_handle` from these rows, so until something could set
 * one, every Kwami in the arena was authored by a truncated wallet address.
 */
export interface ProfileRow {
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  bio: string | null
}

export function useProfile() {
  const supabase = useSupabase()
  const auth = useAuthStore()

  const draft = reactive<ProfileDraft>({ handle: '', displayName: '', bio: '', avatarUrl: '' })
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)

  async function load() {
    const id = auth.user?.id
    if (!id) return
    const { data } = await supabase
      .from('profiles')
      .select('handle, display_name, avatar_url, bio')
      .eq('id', id)
      .maybeSingle<ProfileRow>()

    draft.handle = data?.handle ?? ''
    // A wallet account starts with the shortened address the session put in
    // metadata; showing it beats an empty field someone has to guess at.
    draft.displayName = data?.display_name ?? auth.displayName ?? ''
    draft.avatarUrl = data?.avatar_url ?? ''
    draft.bio = data?.bio ?? ''
    loaded.value = true
  }

  async function save(): Promise<boolean> {
    const id = auth.user?.id
    if (!id) return false
    error.value = null
    notice.value = null

    draft.handle = normalizeHandle(draft.handle)
    const problem = validateProfile(draft)
    if (problem) {
      error.value = problem
      return false
    }

    saving.value = true
    try {
      // Upsert rather than update: the signup trigger creates the row, but an
      // account that predates it would otherwise silently save nothing.
      const { error: e } = await supabase.from('profiles').upsert({
        id,
        handle: draft.handle || null,
        display_name: draft.displayName.trim() || null,
        avatar_url: draft.avatarUrl.trim() || null,
        bio: draft.bio.trim() || null,
      })
      if (e) {
        // 23505 is the unique index on `handle`. The raw message names the
        // constraint, which tells the user nothing they can act on.
        error.value = e.code === '23505' ? 'That handle is taken.' : e.message
        return false
      }

      // The header and every "signed in as" reads `display_name` off the JWT's
      // metadata, so it has to be written too or the name changes everywhere
      // except where people actually look at it.
      await supabase.auth.updateUser({ data: { display_name: draft.displayName.trim() || null } })
      notice.value = 'Profile saved.'
      return true
    } finally {
      saving.value = false
    }
  }

  return { draft, loaded, saving, error, notice, load, save }
}
