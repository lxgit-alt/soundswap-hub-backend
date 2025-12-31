import axios from 'axios';

const BEAM_API_KEY = process.env.BEAM_API_KEY;

export async function triggerBeamJob(data) {
  try {
    const response = await axios.post(
      'https://api.beam.cloud/v1/tasks',
      {
        app_id: process.env.BEAM_APP_ID,
        name: 'generate-lyric-video',
        payload: JSON.stringify(data),
        config: {
          max_runtime: 300 // 5 minutes
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${BEAM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Beam API error:', error.response?.data || error.message);
    throw error;
  }
}

export async function getJobStatus(jobId) {
  try {
    const response = await axios.get(
      `https://api.beam.cloud/v1/tasks/${jobId}`,
      {
        headers: {
          'Authorization': `Bearer ${BEAM_API_KEY}`
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Beam status error:', error.response?.data || error.message);
    throw error;
  }
}