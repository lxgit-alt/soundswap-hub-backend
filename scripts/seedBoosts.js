import { db } from '../firebaseAdmin.js'; // adjust path

const seedBoosts = async () => {
  const boosts = [
    {
      id: 'profileHighlight',
      data: {
        cost: 5,
        effect: {
          type: 'profileHighlight',
          durationHours: 72
        }
      }
    },
    {
      id: 'priorityPairing',
      data: {
        cost: 3,
        effect: {
          type: 'priorityPairing',
          maxUses: 5
        }
      }
    }
  ];

  for (const boost of boosts) {
    await db.collection('boosts').doc(boost.id).set(boost.data);
    console.log(`Boost ${boost.id} seeded`);
  }
};

seedBoosts().then(() => {
  console.log('Seeding done!');
  process.exit(0);
}).catch((error) => {
  console.error('Error seeding boosts:', error);
  process.exit(1);
});
