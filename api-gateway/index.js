const express = require('express');
const cors = require('cors');
const { KafkaConfig, KafkaClient } = require('common');
const Redis = require('ioredis');
const axios = require('axios');
const { Client, Pool } = require('pg');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Redis client
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const redis = new Redis({ host: REDIS_HOST, port: 6379, retryStrategy: (times) => Math.min(times * 500, 3000) });
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err.message));

// PostgreSQL connection pool for route-management DB
const pool = new Pool({
    host: process.env.ROUTES_DB_HOST || 'postgres-routes',
    port: parseInt(process.env.ROUTES_DB_PORT || '5432'),
    database: process.env.ROUTES_DB_NAME || 'routedb',
    user: process.env.ROUTES_DB_USER || 'user',
    password: process.env.ROUTES_DB_PASSWORD || 'password',
});

// Setup Kafka Client
const config = new KafkaConfig()
    .setClusterId('e-commerce')
    .setNodeId('api-gateway')
    .setBrokers(['kafka:9092']);

const kafkaClient = new KafkaClient(config);

// ─── Dynamic Routes Variable ────────────────────────────────────────────────
let dynamicRoutes = [];
let dynamicRouter = express.Router();

// ─── JWT Middleware ──────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ error: 'unauthorized' });

    try {
        const user = jwt.verify(token, JWT_SECRET);

        // Check Redis blacklist
        if (user.jti) {
            const isBlacklisted = await redis.get(`blacklist:${user.jti}`);
            if (isBlacklisted) {
                console.log(`Blocked blacklisted token jti=${user.jti}`);
                return res.status(401).json({ error: 'token_revoked' });
            }
        }

        req.user = user;
        req.token = token;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'forbidden' });
    }
};

const checkAccess = async (req, res, next) => {
    if (!req.user) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const authResponse = await axios.post('http://authz-service:3002/evaluate', {
            userId: req.user.sub,
            method: req.method,
            path: req.originalUrl
        });

        if (authResponse.data.allowed) {
            req.user.role = authResponse.data.role;
            req.user.permissions = authResponse.data.permissions;
            return next();
        } else {
            return res.status(403).json({ error: 'Access denied by AuthZ sidecar' });
        }
    } catch (error) {
        console.error('AuthZ Service Error:', error.message);
        return res.status(500).json({ error: 'Authorization service unavailable' });
    }
};

// ─── Database Initialization ─────────────────────────────────────────────────
async function initDB() {
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS routes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            method VARCHAR(10) NOT NULL,
            path VARCHAR(255) NOT NULL,
            upstream_url VARCHAR(500),
            kafka_topic VARCHAR(255),
            kafka_uri VARCHAR(255),
            auth_required BOOLEAN DEFAULT false,
            authz_required BOOLEAN DEFAULT false,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(method, path)
        );
    `;
    await pool.query(createTableSQL);
    console.log('Routes table initialized');
}

async function seedDefaultRoutes() {
    const defaults = [
        { name: 'List Users', method: 'GET', path: '/users', kafka_topic: 'user-service-topic', kafka_uri: '/users', auth_required: false, authz_required: false },
        { name: 'List Products', method: 'GET', path: '/products', kafka_topic: 'product-service-topic', kafka_uri: '/products', auth_required: false, authz_required: false },
        { name: 'List Orders', method: 'GET', path: '/orders', kafka_topic: 'order-service-topic', kafka_uri: '/orders', auth_required: true, authz_required: true },
        { name: 'Export Orders', method: 'GET', path: '/exports/orders', kafka_topic: 'export-service-topic', kafka_uri: '/exports/orders', auth_required: true, authz_required: true },
        { name: 'Logout', method: 'POST', path: '/auth/logout', upstream_url: 'http://idp-service:3001/oauth/revoke', auth_required: true, authz_required: false },
    ];

    for (const route of defaults) {
        await pool.query(
            `INSERT INTO routes (name, method, path, upstream_url, kafka_topic, kafka_uri, auth_required, authz_required)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (method, path) DO NOTHING`,
            [route.name, route.method, route.path, route.upstream_url || null, route.kafka_topic || null, route.kafka_uri || null, route.auth_required, route.authz_required]
        );
    }
    console.log('Default routes seeded');
}

// ─── Publish Kafka Route Update Event ────────────────────────────────────────
async function publishRouteUpdate(event, routeId) {
    try {
        await kafkaClient.sendMessage('route-management.routes.updated', '/routes-updated', {
            event,
            routeId,
            timestamp: new Date().toISOString(),
        });
        console.log(`Published route event: ${event}`);
    } catch (err) {
        console.warn('Failed to publish route update event:', err.message);
    }
}

// ─── Load Routes from DB ─────────────────────────────────────────────────────
async function loadRoutesFromDB() {
    const result = await pool.query('SELECT * FROM routes WHERE is_active = true');
    dynamicRoutes = result.rows;
    console.log(`Loaded ${dynamicRoutes.length} active routes from DB`);
    rebuildDynamicRouter();
}

// ─── Rebuild Express Router from Dynamic Routes ─────────────────────────────
function rebuildDynamicRouter() {
    const newRouter = express.Router();

    for (const route of dynamicRoutes) {
        const method = route.method.toLowerCase();
        const path = route.path;

        // Build middleware chain
        const middlewares = [];
        if (route.auth_required) middlewares.push(authenticateToken);
        if (route.authz_required) middlewares.push(checkAccess);

        // Build handler
        const handler = createRouteHandler(route);
        middlewares.push(handler);

        // Register on router
        if (typeof newRouter[method] === 'function') {
            newRouter[method](path, ...middlewares);
            console.log(`  Registered: ${route.method} ${path} → ${route.kafka_topic || route.upstream_url}`);
        }
    }

    dynamicRouter = newRouter;
    console.log('Dynamic router rebuilt successfully');
}

// ─── Create Route Handler ────────────────────────────────────────────────────
function createRouteHandler(route) {
    // Kafka-based route
    if (route.kafka_topic) {
        return async (req, res) => {
            try {
                const data = ['GET', 'DELETE'].includes(route.method) ? null : req.body;

                const headers = {};
                if (req.user) {
                    headers['X-User-Id'] = String(req.user.sub);
                    if (req.user.permissions) {
                        headers['X-User-Permissions'] = req.user.permissions.join(',');
                    }
                }

                const response = await kafkaClient.sendRequest(
                    route.kafka_topic,
                    route.kafka_uri || route.path,
                    data,
                    headers
                );
                res.json(response.data);
            } catch (error) {
                console.error(`Error proxying ${route.method} ${route.path}:`, error.message || error);
                res.status(500).json({ error: `Failed to proxy ${route.method} ${route.path}` });
            }
        };
    }

    // HTTP upstream route
    if (route.upstream_url) {
        return async (req, res) => {
            try {
                const headers = {};
                if (req.token) {
                    headers['Authorization'] = `Bearer ${req.token}`;
                }

                const axiosConfig = {
                    method: route.method.toLowerCase(),
                    url: route.upstream_url,
                    headers,
                };

                if (!['GET', 'DELETE'].includes(route.method)) {
                    axiosConfig.data = req.body;
                }

                const response = await axios(axiosConfig);
                res.json(response.data);
            } catch (error) {
                console.error(`Error proxying ${route.method} ${route.path}:`, error.message);
                res.status(error.response?.status || 500).json(
                    error.response?.data || { error: `Failed to proxy ${route.method} ${route.path}` }
                );
            }
        };
    }

    // Fallback
    return (req, res) => {
        res.status(502).json({ error: `No upstream configured for ${route.method} ${route.path}` });
    };
}

// ─── Main Start ──────────────────────────────────────────────────────────────
async function start() {
    await kafkaClient.connect();

    // Listen for Kafka response topics (existing behavior)
    const responseConsumer = kafkaClient.kafka.consumer({ groupId: 'api-gateway-group' });
    await responseConsumer.connect();
    await responseConsumer.subscribe({ topic: 'e-commerce.response.api-gateway', fromBeginning: false });

    await responseConsumer.run({
        eachMessage: async ({ message }) => {
            const payload = JSON.parse(message.value.toString());
            kafkaClient.handleResponse(payload);
        }
    });

    // Listen for route update notifications (from other gateway instances if scaled)
    const routeConsumer = kafkaClient.kafka.consumer({ groupId: `api-gateway-route-updates-${process.env.HOSTNAME || 'default'}` });
    await routeConsumer.connect();
    await routeConsumer.subscribe({ topic: 'route-management.routes.updated', fromBeginning: false });

    await routeConsumer.run({
        eachMessage: async ({ message }) => {
            try {
                const payload = JSON.parse(message.value.toString());
                console.log('Route update event received:', payload);
                await loadRoutesFromDB();
            } catch (err) {
                console.error('Error handling route update event:', err.message);
            }
        }
    });

    // ─── Route Management CRUD API (/manage/routes) ──────────────────────────

    // List all routes
    app.get('/manage/routes', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM routes ORDER BY id');
            res.json({ data: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get active routes only
    app.get('/manage/routes/active', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM routes WHERE is_active = true ORDER BY id');
            res.json({ data: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get single route
    app.get('/manage/routes/:id', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM routes WHERE id = $1', [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
            res.json({ data: result.rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Create route
    app.post('/manage/routes', async (req, res) => {
        try {
            const { name, method, path, upstream_url, kafka_topic, kafka_uri, auth_required, authz_required, is_active } = req.body;

            if (!name || !method || !path) {
                return res.status(400).json({ error: 'name, method, and path are required' });
            }

            const result = await pool.query(
                `INSERT INTO routes (name, method, path, upstream_url, kafka_topic, kafka_uri, auth_required, authz_required, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [name, method.toUpperCase(), path, upstream_url || null, kafka_topic || null, kafka_uri || null,
                 auth_required ?? false, authz_required ?? false, is_active ?? true]
            );

            const created = result.rows[0];
            await publishRouteUpdate('route.created', created.id);
            await loadRoutesFromDB();

            res.status(201).json({ data: created });
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Route with this method and path already exists' });
            }
            res.status(500).json({ error: err.message });
        }
    });

    // Update route
    app.put('/manage/routes/:id', async (req, res) => {
        try {
            const { name, method, path, upstream_url, kafka_topic, kafka_uri, auth_required, authz_required, is_active } = req.body;

            const result = await pool.query(
                `UPDATE routes SET
                    name = COALESCE($1, name),
                    method = COALESCE($2, method),
                    path = COALESCE($3, path),
                    upstream_url = $4,
                    kafka_topic = $5,
                    kafka_uri = $6,
                    auth_required = COALESCE($7, auth_required),
                    authz_required = COALESCE($8, authz_required),
                    is_active = COALESCE($9, is_active),
                    updated_at = NOW()
                 WHERE id = $10
                 RETURNING *`,
                [name, method?.toUpperCase(), path, upstream_url ?? null, kafka_topic ?? null, kafka_uri ?? null,
                 auth_required, authz_required, is_active, req.params.id]
            );

            if (result.rows.length === 0) return res.status(404).json({ error: 'Route not found' });

            const updated = result.rows[0];
            await publishRouteUpdate('route.updated', updated.id);
            await loadRoutesFromDB();

            res.json({ data: updated });
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Route with this method and path already exists' });
            }
            res.status(500).json({ error: err.message });
        }
    });

    // Delete route
    app.delete('/manage/routes/:id', async (req, res) => {
        try {
            const result = await pool.query('DELETE FROM routes WHERE id = $1 RETURNING *', [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Route not found' });

            await publishRouteUpdate('route.deleted', req.params.id);
            await loadRoutesFromDB();

            res.status(204).send();
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ─── Special Routes (complex orchestration, kept hardcoded) ──────────────

    // USER/ADMIN: Create order → Stripe checkout (multi-step orchestration)
    app.post('/orders', authenticateToken, checkAccess, async (req, res) => {
        try {
            const userId = req.user.sub;
            const productId = req.body.productId;

            const orderResponse = await kafkaClient.sendRequest('order-service-topic', '/orders/create', {
                userId,
                productId
            });
            const orderId = orderResponse.data.id;

            const productResponse = await kafkaClient.sendRequest('product-service-topic', '/products', null);
            const products = productResponse.data;
            const product = Array.isArray(products) ? products.find(p => p.id === productId) : null;

            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const priceInCents = Math.round(product.price * 100);

            const paymentResponse = await kafkaClient.sendRequest('payment-service-topic', '/payments/create-session', {
                orderId,
                productName: product.name,
                priceInCents
            });

            res.json({
                orderId,
                checkoutUrl: paymentResponse.data.checkoutUrl,
                status: 'PENDING'
            });

        } catch (error) {
            console.error("Error creating order:", error);
            res.status(500).json({ error: 'Failed to create order: ' + error.message });
        }
    });

    // ─── Dynamic Router Mount ────────────────────────────────────────────────
    app.use((req, res, next) => dynamicRouter(req, res, next));

    // ─── Initialize DB + Load Routes ─────────────────────────────────────────
    const initWithRetry = async (retries = 15, delay = 3000) => {
        for (let i = 0; i < retries; i++) {
            try {
                await initDB();
                await seedDefaultRoutes();
                await loadRoutesFromDB();
                return;
            } catch (err) {
                console.log(`DB init attempt ${i + 1}/${retries} failed: ${err.message}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        console.error('Failed to initialize DB after all retries. Gateway will serve special routes only.');
    };

    await initWithRetry();

    app.listen(port, () => {
        console.log(`API Gateway listening on port ${port}`);
    });
}

start().catch(console.error);
