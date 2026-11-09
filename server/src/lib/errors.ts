import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, `${what} não encontrado.`, 'not_found');

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Dados inválidos.',
      code: 'validation_error',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON inválido.', code: 'bad_json' });
    return;
  }
  // violação de chave estrangeira / unicidade vindas do Postgres
  if (err?.code === '23503') {
    res.status(400).json({ error: 'Referência inválida.', code: 'invalid_reference' });
    return;
  }
  if (err?.code === '22P02') {
    res.status(400).json({ error: 'Identificador inválido.', code: 'invalid_id' });
    return;
  }
  console.error('[http] erro não tratado', err);
  res.status(500).json({ error: 'Erro interno do servidor.', code: 'internal' });
};
