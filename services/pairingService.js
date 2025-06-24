// backend/services/pairingService.js

import { db } from '../firebaseAdmin.js'

/**
 * Fetch users in a genre who have an unreviewed track URL, prioritize by boosts,
 * and then pair them sequentially.
 */
export async function getRandomPairsByGenre(genre) {
  const usersRef = db.collection('users')
  const snapshot = await usersRef
    .where('genres', 'array-contains', genre)
    .where('hasUnreviewedTrack', '==', true)
    .where('trackURL', '!=', null) // only those who submitted a URL
    .limit(50)
    .get()

  if (snapshot.empty) {
    return []
  }

  const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))

  // Prioritize users with remaining priorityPairing boosts
  const prioritized = users.sort((a, b) => {
    const aBoost = (a.boosts?.priorityPairing?.remainingUses || 0) > 0 ? 1 : 0
    const bBoost = (b.boosts?.priorityPairing?.remainingUses || 0) > 0 ? 1 : 0
    return bBoost - aBoost
  })

  // Now create pairs sequentially
  const pairs = []
  for (let i = 0; i < prioritized.length; i += 2) {
    if (i + 1 < prioritized.length) {
      pairs.push([prioritized[i], prioritized[i + 1]])
    }
  }

  return pairs
}
