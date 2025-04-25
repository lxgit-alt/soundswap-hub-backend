import { db } from '../lib/firebaseAdmin';

export const generatePairs = async (genre) => {
  const usersRef = db.collection('users');
  const snapshot = await usersRef
    .where('genres', 'array-contains', genre)
    .where('hasUnreviewedTrack', '==', true)
    .where('trackURL', '!=', null) // Added condition to exclude null trackURL
    .limit(50)
    .get();

  if (snapshot.empty) return [];

  const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Prioritize users who have priorityPairing boosts
  return users
    .sort((a, b) => {
      const aBoost = (a.boosts?.priorityPairing?.remainingUses || 0) > 0 ? 1 : 0;
      const bBoost = (b.boosts?.priorityPairing?.remainingUses || 0) > 0 ? 1 : 0;
      return bBoost - aBoost;
    })
    .reduce((pairs, user, index, sortedUsers) => {
      if (index % 2 === 0) {
        pairs.push(sortedUsers.slice(index, index + 2));
      }
      return pairs;
    }, []);
};

const shuffleArray = (array) => {
  return [...array].sort(() => Math.random() - 0.5);
};

const createPairs = (users) => {
  const pairs = [];
  for (let i = 0; i < users.length; i += 2) {
    if (i + 1 >= users.length) break;
    pairs.push([users[i], users[i + 1]]);
  }
  return pairs;
};