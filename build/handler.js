import { createServer } from 'http';
import { parse } from 'url';
import { join, extname } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = new URL('.', import.meta.url).pathname;

const mimeTypes = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

export async function handler(req, res) {
  try {
    const { pathname } = parse(req.url);

    // Handle API routes
    if (pathname.startsWith('/api')) {
      const apiPath = join(__dirname, '../api', `${pathname.replace('/api', '')}.js`);
      if (!existsSync(apiPath)) {
        res.statusCode = 404;
        res.end('API Not Found');
        return;
      }
      const { default: apiHandler } = await import(apiPath);
      return apiHandler(req, res);
    }

    // Handle static files
    const filePath = join(__dirname, '../public', pathname === '/' ? 'index.html' : pathname);
    if (!existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    const ext = extname(filePath);
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    const data = await readFile(filePath);
    res.end(data);
  } catch (error) {
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}