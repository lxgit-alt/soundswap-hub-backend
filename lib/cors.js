// backend/lib/cors.js
const microCors = require('micro-cors');

// Allow all origins and common methods; adjust origin in production!
module.exports = microCors({
  allowMethods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  origin: '*',
});
