import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 n'intercepte pas les promesses rejetées : on les transmet à errorHandler. */
export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
