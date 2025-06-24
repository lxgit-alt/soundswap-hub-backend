import { type APIHandler } from '../types/handler.js';

const handler: APIHandler = async (req, res) => {
  res.status(200).json({ 
    message: 'API is working',
    path: req.path,
    time: new Date().toISOString()
  });
};

export default handler;
