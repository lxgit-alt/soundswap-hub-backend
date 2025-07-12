// backend/services/pairingService.js

import { db } from '../firebaseAdmin.js';

/**
 * Fetch users in a genre who have an unreviewed track URL, prioritize by boosts,
 * and then pair them sequentially.
 */
export async function getRandomPairsByGenre(genre) {
  if (!genre) return [];

  const usersRef = db.collection('users');
  const snapshot = await usersRef
    .where('genres', 'array-contains', genre)
    .where('hasUnreviewedTrack', '==', true)
    .where('trackURL', '!=', null) // only those who submitted a URL
    .limit(50)
    .get();

  if (snapshot.empty) {
    return [];
  }

  const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Prioritize users with remaining priorityPairing boosts
  const prioritized = users.sort((a, b) => {
    const aBoost = (a.boosts?.priorityPairing?.remainingUses || 0) > 0 ? 1 : 0;
    const bBoost = (b.boosts?.priorityPairing?.remainingUses || 0) > 0 ? 1 : 0;
    return bBoost - aBoost;
  });

  // Shuffle users within each boost group for randomness
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const boosted = prioritized.filter(u => (u.boosts?.priorityPairing?.remainingUses || 0) > 0);
  const normal = prioritized.filter(u => !(u.boosts?.priorityPairing?.remainingUses > 0));
  const shuffled = [...shuffle(boosted), ...shuffle(normal)];

  // Now create pairs sequentially
  const pairs = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    if (i + 1 < shuffled.length) {
      pairs.push([shuffled[i], shuffled[i + 1]]);
    }
  }

  return pairs;
}
