// POST /api/analyze { image, mimeType } → { result, model } or { error, kind }. Logic: server/analyze.js
import { toNode } from '../server/http.js';
import { ROUTES } from '../server/routes.js';

export const config = { maxDuration: 60 };
export default toNode(ROUTES['/api/analyze']);
