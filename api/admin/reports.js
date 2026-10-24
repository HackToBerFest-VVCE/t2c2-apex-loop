// GET /api/admin/reports: every report, for admin Google accounts only. Logic: server/reports.js
import { toNode } from '../../server/http.js';
import { ROUTES } from '../../server/routes.js';

export default toNode(ROUTES['/api/admin/reports']);
