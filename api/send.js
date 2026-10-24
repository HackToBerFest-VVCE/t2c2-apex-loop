// POST /api/send { subject, body, photo } → sends from the signed-in user's Gmail. Logic: server/send.js
import { toNode } from '../server/http.js';
import { ROUTES } from '../server/routes.js';

export const config = { maxDuration: 30 };
export default toNode(ROUTES['/api/send']);
