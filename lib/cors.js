import microCors from 'micro-cors';

// Allow all origins and common methods; adjust origin in production!
const cors = microCors({
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  origin: '*',
});

export default cors;
