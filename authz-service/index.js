const express = require('express');

const app = express();
const port = 3002;

app.use(express.json());

// Define role → permissions mapping internally
const ROLE_PERMISSIONS = {
  ADMIN: ['orders:read', 'orders:create', 'orders:update', 'users:read', 'users:update', 'products:read', 'products:create', 'products:update'],
  USER:  ['orders:create', 'products:read']
};

// Simple Access Rules Engine
const evaluateRules = (role, permissions, method, path) => {
    // Admins bypass all restrictions
    if (role === 'ADMIN') return true;

    // Normal Users
    if (role === 'USER') {
        if (method === 'POST' && path === '/orders') {
            return permissions.includes('orders:create');
        }
        if (method === 'GET' && path === '/orders') {
            return permissions.includes('orders:read');
        }
    }

    return false;
};

app.post('/evaluate', (req, res) => {
    const { userId, role, method, path } = req.body;

    if (!userId || !role) {
        return res.status(400).json({ error: 'userId and role are required', allowed: false });
    }

    try {
        const permissions = ROLE_PERMISSIONS[role.toUpperCase()] || [];
        
        console.log(`[AUTHZ] Evaluating Access for User ${userId} (${role}) -> ${method} ${path}`);
        const allowed = evaluateRules(role.toUpperCase(), permissions, method, path);

        return res.json({ allowed, role: role.toUpperCase(), permissions });

    } catch (err) {
        console.error('[AUTHZ] Evaluation Error:', err);
        return res.status(500).json({ allowed: false, error: 'internal_error' });
    }
});

app.listen(port, () => {
    console.log(`AuthZ Service listening on port ${port}`);
    console.log(`Evaluating policies strictly in-memory.`);
});
