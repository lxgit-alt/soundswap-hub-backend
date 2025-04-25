import { authenticate } from '../lib/authMiddleware';
import { db } from '../lib/firebaseAdmin';

const ALLOWED_DOMAINS = ['soundcloud.com', 'open.spotify.com'];

const validateTrackURL = (url) => {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some(domain => parsed.hostname.includes(domain));
  } catch {
    return false;
  }
};

export default authenticate(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { trackURL } = req.body;

  if (!validateTrackURL(trackURL)) {
    return res.status(400).json({
      error: "Only SoundCloud/Spotify URLs allowed"
    });
  }

  await db.collection('users').doc(req.user.uid).update({
    trackURL,
    hasUnreviewedTrack: true,
    lastSubmitted: new Date()
  });

  res.status(200).json({ success: true });
});