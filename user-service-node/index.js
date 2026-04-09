const { Client } = require('pg');
const { KafkaConfig, KafkaClient, RequestHandler } = require('common');

async function start() {
    console.log("Starting user-service-node...");

    // 1. Setup PostgreSQL
    let clientDb;
    let connected = false;
    while (!connected) {
        clientDb = new Client({
            user: 'user',
            host: 'postgres',
            database: 'userdb',
            password: 'password',
            port: 5432,
        });
        try {
            await clientDb.connect();
            connected = true;
            console.log("Connected to PostgreSQL");
        } catch(e) {
            console.log("Waiting for PostgreSQL...", e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // 2. Setup Kafka Client
    const config = new KafkaConfig()
        .setClusterId('e-commerce')
        .setNodeId('user-service-node')
        .setBrokers(['kafka:9092']);

    const kafkaClient = new KafkaClient(config);
    await kafkaClient.connect();

    // 3. Setup RequestHandler mappings
    const handler = new RequestHandler(config, kafkaClient);
    handler.handle("/users-node", async (msg) => {
        try {
            const res = await clientDb.query('SELECT * FROM users');
            return res.rows; // return raw js array to be serialized gracefully by commonJS 
        } catch(e) {
            console.error("DB Error", e);
            throw new Error("Failed to fetch users");
        }
    });

    // 4. Listen exactly like Java @KafkaListener
    const consumer = kafkaClient.kafka.consumer({ groupId: 'user-service-node-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'user-service-node-topic', fromBeginning: false });
    
    await consumer.run({
        eachMessage: async ({ message }) => {
            const payload = message.value.toString();
            handler.dispatch(payload);
        }
    });

    console.log("user-service-node running and listening on user-service-node-topic!");
}

start();
