import { decryptSecret } from './crypto'
import { serviceClient } from './supabase'

/**
 * Read a Kwami's plaintext secret.
 *
 * The single choke point through which a secret ever becomes readable. Every
 * caller is inside `server/`, and the result must never appear in a response
 * body except as part of a *verified win* — that is the one moment a
 * challenger has earned the pre-image.
 */
export async function loadSecret(kwamiId: string): Promise<{ secret: string; salt: string }> {
  const config = useRuntimeConfig()
  if (!config.secretEncryptionKey) {
    throw createError({ statusCode: 500, statusMessage: 'Secret encryption key is not configured.' })
  }

  const { data, error } = await serviceClient()
    .from('kwami_secrets')
    .select('ciphertext, salt')
    .eq('kwami_id', kwamiId)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!data) throw createError({ statusCode: 500, statusMessage: 'This Kwami has no secret on record.' })

  return { secret: decryptSecret(data.ciphertext, config.secretEncryptionKey), salt: data.salt }
}
