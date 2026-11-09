import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { userId } from '../middleware/auth.js';

export const categoriesRouter = Router();

const colorRe = /^#[0-9a-fA-F]{6}$/;
const createSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(40),
  color: z.string().regex(colorRe, 'Cor inválida.'),
  icon: z.string().trim().min(1).max(40).default('tag'),
});
const updateSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(40).optional(),
  color: z.string().regex(colorRe, 'Cor inválida.').optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  position: z.number().int().min(0).optional(),
});

const cols = 'id, name, color, icon, position';

categoriesRouter.get('/', async (req, res) => {
  const { rows } = await query(`SELECT ${cols} FROM categories WHERE user_id = $1 ORDER BY position, created_at`, [userId(req)]);
  res.json({ categories: rows });
});

categoriesRouter.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO categories (user_id, name, color, icon, position)
     VALUES ($1, $2, $3, $4, (SELECT coalesce(max(position) + 1, 0) FROM categories WHERE user_id = $1))
     RETURNING ${cols}`,
    [userId(req), body.name, body.color, body.icon],
  );
  res.status(201).json({ category: rows[0] });
});

categoriesRouter.patch('/:id', async (req, res) => {
  const body = updateSchema.parse(req.body);
  const { rows } = await query(
    `UPDATE categories SET
        name = coalesce($3, name), color = coalesce($4, color), icon = coalesce($5, icon), position = coalesce($6, position)
      WHERE id = $1 AND user_id = $2 RETURNING ${cols}`,
    [req.params.id, userId(req), body.name ?? null, body.color ?? null, body.icon ?? null, body.position ?? null],
  );
  if (!rows[0]) throw notFound('Categoria');
  res.json({ category: rows[0] });
});

categoriesRouter.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [req.params.id, userId(req)]);
  if (!rowCount) throw notFound('Categoria');
  res.json({ ok: true });
});
