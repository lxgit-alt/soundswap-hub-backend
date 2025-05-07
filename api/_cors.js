// backend/api/_cors.js
export function allowCors(fn) {
    return async (req, res) => {
      // 1) set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization'
      );
  
      // 2) handle preflight
      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }
  
      // 3) run the actual function
      return await fn(req, res);
    };
  }
  