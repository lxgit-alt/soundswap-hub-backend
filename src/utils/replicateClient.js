import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export const generateArtFromSketch = async (imageBase64, prompt, conditioningScale = 0.8) => {
  try {
    // Remove the data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    // Create a data URL for Replicate
    const imageDataUrl = `data:image/png;base64,${base64Data}`;
    
    const input = {
      image: imageDataUrl,
      prompt: prompt,
      num_outputs: 1,
      image_resolution: "512",
      num_inference_steps: 50,
      guidance_scale: 7.5,
      scheduler: "DPMSolverMultistep",
      conditioning_scale: Math.min(Math.max(parseFloat(conditioningScale), 0.1), 1.0),
    };

    console.log('Calling Replicate API for doodle-to-art...');
    
    const output = await replicate.run(
      "jagilley/controlnet-scribble:435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2de23e143fdb0117",
      { input }
    );

    return output;
  } catch (error) {
    console.error('Replicate API error:', error);
    
    // Check for specific error types
    if (error.message?.includes('NSFW') || error.message?.includes('inappropriate')) {
      throw new Error('NSFW content detected. Please try a different sketch or prompt.');
    }
    
    if (error.message?.includes('credit') || error.message?.includes('payment')) {
      throw new Error('Insufficient credits. Please check your Replicate account.');
    }
    
    throw error;
  }
};

export const testReplicateConnection = async () => {
  try {
    console.log('Testing Replicate connection...');
    // Simple test call to check if API token works
    await replicate.models.get("jagilley/controlnet-scribble");
    return { success: true, message: 'Replicate API connected successfully' };
  } catch (error) {
    console.error('Replicate connection test failed:', error);
    return { 
      success: false, 
      message: 'Replicate API connection failed',
      error: error.message 
    };
  }
};

export default replicate;