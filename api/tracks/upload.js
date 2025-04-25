import { authenticate } from '../../lib/authMiddleware';
import { storage } from '../../lib/firebaseAdmin'; // From your existing setup
import { v4 as uuidv4 } from 'uuid';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb' // For audio files
    }
  }
};

export default authenticate(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const bucket = storage.bucket();
    const fileName = `${req.user.uid}/${uuidv4()}.mp3`;
    const file = bucket.file(fileName);

    // Upload buffer directly
    await file.save(req.body, {
      metadata: {
        contentType: 'audio/mpeg',
      },
    });

    // Get public URL
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-09-2491' // Far future date
    });

    res.status(200).json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});