import type { Request, Response } from 'express';

export type APIHandler = (req: Request, res: Response) => Promise<void> | void;