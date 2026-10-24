// /api/auth/me: see server/auth.js
import { toNode } from '../../server/http.js';
import { ROUTES } from '../../server/routes.js';

export default toNode(ROUTES['/api/auth/me']);
