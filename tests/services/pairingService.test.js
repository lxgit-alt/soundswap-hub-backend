import { generatePairs } from '../../services/pairingService';

jest.mock('../../lib/firebaseAdmin', () => ({
  db: {
    collection: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn()
  }
}));

describe('Pairing Service', () => {
  it('should generate valid pairs', async () => {
    // Mock Firestore response
    const mockUsers = Array(5).fill().map((_, i) => ({ id: `user${i}` }));
    require('../../lib/firebaseAdmin').db.get.mockResolvedValue({
      empty: false,
      docs: mockUsers.map(user => ({ id: user.id, data: () => user }))
    });

    const pairs = await generatePairs('rock');
    expect(pairs.length).toBeGreaterThan(0);
    pairs.forEach(pair => {
      expect(pair.length).toBe(2);
      expect(pair[0].id).not.toBe(pair[1].id);
    });
  });
});