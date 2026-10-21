'use strict';
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth } = require('../middleware/auth');
const { ok } = require('../util/http');
const dashboard = require('../services/dashboard');
const rbac = require('../middleware/rbac');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  ok(res, dashboard.getDashboard({
    user: req.user,
    canViewAll: rbac.can(req.user, 'upload.view.all'),
  }));
}));

module.exports = router;
