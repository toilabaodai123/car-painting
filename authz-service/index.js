const express = require('express');
const Redis = require('ioredis');
const NodeCache = require('node-cache');

const app = express();
const port = 3002;

app.use(express.json());

// Redis Connection
const redisHost = process.env.REDIS_HOST || 'localhost';
const redis = new Redis({ host: redisHost, port: 6379 });

// In-Memory Cache (TTL: 60 seconds)
const userCache = new NodeCache({ stdTTL: 60, checkperiod: 10 });

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

app.post('/evaluate', async (req, res) => {
    const { userId, method, path } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required', allowed: false });
    }

    try {
        let userData = userCache.get(userId);

        if (!userData) {
            // Cache Miss: Fetch from Redis
            console.log(`[AUTHZ] Cache Miss for User ${userId}. Fetching from Redis...`);
            const raw = await redis.get(`permissions:${userId}`);
            
            if (raw) {
                userData = JSON.parse(raw);
                // Save to NodeCache (TTL is 60s as configured globally)
                userCache.set(userId, userData);
            } else {
                console.log(`[AUTHZ] Rediss Miss - No permissions found for User ${userId}`);
                return res.json({ allowed: false, reason: 'no_permissions_found' });
            }
        } else {
            console.log(`[AUTHZ] Cache Hit for User ${userId}`);
        }

        const { role, permissions } = userData;
        const allowed = evaluateRules(role, permissions, method, path);

        return res.json({ allowed, role, permissions });

    } catch (err) {
        console.error('[AUTHZ] Evaluation Error:', err);
        return res.status(500).json({ allowed: false, error: 'internal_error' });
    }
});

app.listen(port, () => {
    console.log(`AuthZ Service listening on port ${port}`);
    console.log(`Using Redis at ${redisHost}:6379 with 60s in-memory caching`);
});
