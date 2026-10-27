// GET/POST /api/whatsapp: the WhatsApp bot's webhook (Meta Cloud API). Logic: server/whatsapp.js
import { toNode } from '../server/http.js';
import { ROUTES } from '../server/routes.js';

export const config = { maxDuration: 60 };
export default toNode(ROUTES['/api/whatsapp']);
