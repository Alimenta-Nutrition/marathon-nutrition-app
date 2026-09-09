import deleteHandler from '../handlers/deleteMeal.js';
import updateHandler from '../handlers/updateMeal.js';

export default async function handler(req, res) {
  if (req.method === 'DELETE') return deleteHandler(req, res);
  if (req.method === 'PATCH') return updateHandler(req, res);
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
