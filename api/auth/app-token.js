// POST /api/auth/app-token: finishes Google sign-in for the Android app. Logic: server/auth.js
import { toNode } from '../../server/http.js';
import { ROUTES } from '../../server/routes.js';

export default toNode(ROUTES['/api/auth/app-token']);
