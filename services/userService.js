import { db } from '../firebaseAdmin'; // or wherever you import Firestore

export const createUserProfile = async (userId, userData) => {
  await db.collection('users').doc(userId).set({
    email: "user@example.com",
    genres: ["rock", "pop"],
    trackURL: "https://open.spotify.com/track/...", // Updated example URL
    hasUnreviewedTrack: true,
    feedbackPoints: 0,
    createdAt: Timestamp,

    // New fields added here
    feedbackPoints: 0,
    boosts: {},
    socialLinks: { // New optional field
      spotifyProfile: "",
      soundcloudProfile: ""
    }
  });
};
