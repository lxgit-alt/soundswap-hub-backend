import { createServer } from 'http';
import { parse } from 'url';
import { join } from 'path';
import { readFile } from 'fs/promises';

const __dirname = new URL('.', import.meta.url).pathname;

export async function handler(req, res) {
  try {
    const { pathname } = parse(req.url);
    
    // Handle API routes
    if (pathname.startsWith('/api')) {
      const apiPath = join(__dirname, '../api', `${pathname.replace('/api', '')}.js`);
      const { default: apiHandler } = await import(apiPath);
      return apiHandler(req, res);
    }

    // Handle static files
    const filePath = join(__dirname, '../public', pathname === '/' ? 'index.html' : pathname);
    const data = await readFile(filePath);
    res.end(data);
  } catch (error) {
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}