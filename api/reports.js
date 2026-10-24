// POST /api/reports: records reports in the shared log. Logic: server/reports.js
import { toNode } from '../server/http.js';
import { ROUTES } from '../server/routes.js';

export default toNode(ROUTES['/api/reports']);
