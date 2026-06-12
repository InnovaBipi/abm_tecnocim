import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Reusable Zod validation middleware factory.
 *
 * Each helper parses a part of the incoming request against a Zod schema and,
 * on failure, responds with `400 { success: false, error: 'Validation failed', details }`
 * following the platform's standard API response format. On success the parsed
 * (and coerced) value is written back onto the request and `next()` is called.
 *
 * Usage:
 *
 *   import { z } from 'zod';
 *   import { validateBody, validateQuery, validateParams } from '../middleware/validate';
 *
 *   const createSchema = z.object({ email: z.string().email() });
 *   router.post('/', validateBody(createSchema), handler);
 *
 *   const listSchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
 *   router.get('/', validateQuery(listSchema), handler);
 *
 *   const idSchema = z.object({ id: z.string().uuid() });
 *   router.get('/:id', validateParams(idSchema), handler);
 *
 * NOTE: This middleware is provided for reuse by new/refactored routes. It is
 * intentionally NOT applied globally so existing inline validation keeps working.
 */

type RequestPart = 'body' | 'query' | 'params';

function makeValidator(part: RequestPart) {
  return <T>(schema: ZodSchema<T>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const result = schema.safeParse(req[part]);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: result.error.flatten().fieldErrors,
        });
        return;
      }

      // Write the parsed/coerced value back so downstream handlers get typed data.
      // `query` and `params` are read-only getters on some Express setups, so we
      // assign defensively and ignore if it is not writable.
      try {
        (req as Record<RequestPart, unknown>)[part] = result.data;
      } catch {
        /* part not writable (e.g. getter-only) — leave original in place */
      }

      next();
    };
}

/** Validate `req.body` against a Zod schema. */
export const validateBody = makeValidator('body');

/** Validate `req.query` against a Zod schema. */
export const validateQuery = makeValidator('query');

/** Validate `req.params` against a Zod schema. */
export const validateParams = makeValidator('params');
