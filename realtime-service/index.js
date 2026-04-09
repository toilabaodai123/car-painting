const { Server } = require('socket.io');
const { Kafka } = require('kafkajs');
const http = require('http');

const PORT = 3003;

// Create HTTP server + Socket.IO
const server = http.createServer();
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Kafka consumer for order status updates
const kafka = new Kafka({
    clientId: 'realtime-service',
    brokers: ['kafka:9092'],
    retry: { retries: 10, initialRetryTime: 3000 }
});

const consumer = kafka.consumer({ groupId: 'realtime-service-group' });

// Track connected users: Map<userId, Set<socketId>>
const userSockets = new Map();

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Client joins a room for their userId
    socket.on('join', (userId) => {
        const room = `user:${userId}`;
        socket.join(room);
        console.log(`Socket ${socket.id} joined room ${room}`);
    });

    // Client can also join a room for a specific order
    socket.on('watch-order', (orderId) => {
        const room = `order:${orderId}`;
        socket.join(room);
        console.log(`Socket ${socket.id} watching order ${orderId}`);
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

async function startKafkaConsumer() {
    let connected = false;
    while (!connected) {
        try {
            await consumer.connect();
            await consumer.subscribe({ topic: 'order-status-updates', fromBeginning: false });
            connected = true;
        } catch (e) {
            console.error('Kafka connection failed, retrying in 3s...', e.message);
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    await consumer.run({
        eachMessage: async ({ message }) => {
            try {
                const event = JSON.parse(message.value.toString());
                console.log('Order status event received:', event);

                const { orderId, userId, status, productId } = event;

                // Emit to user room
                io.to(`user:${userId}`).emit('order-status-update', {
                    orderId,
                    status,
                    productId,
                    timestamp: new Date().toISOString()
                });

                // Emit to order-specific room
                io.to(`order:${orderId}`).emit('order-status-update', {
                    orderId,
                    status,
                    productId,
                    timestamp: new Date().toISOString()
                });

                console.log(`Pushed status update: order ${orderId} → ${status} (user ${userId})`);
            } catch (e) {
                console.error('Error processing status event:', e.message);
            }
        }
    });

    console.log('Kafka consumer connected, listening for order-status-updates');
}

// Start everything
server.listen(PORT, () => {
    console.log(`Realtime service (Socket.IO) listening on port ${PORT}`);
});

startKafkaConsumer().catch(console.error);
