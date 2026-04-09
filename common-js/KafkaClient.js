const { Kafka } = require('kafkajs');
const { randomUUID } = require('crypto');
const { Message, Response } = require('./Message');
const MessageContextHolder = require('./MessageContextHolder');

class GeneralError extends Error {
    constructor(code, msgParams = null) {
        super(code);
        this.code = code;
        this.messageParams = msgParams;
        this.source = null;
        this.params = null;
    }

    static newTimeout(resource) {
        return new GeneralError('TIMEOUT', [resource]);
    }
}

class KafkaClient {
    constructor(config) {
        this.config = config;
        this.kafka = new Kafka({
            clientId: config.nodeId,
            brokers: config.brokers
        });
        this.producer = this.kafka.producer();
        this.pendingRequests = new Map();
        
        this._isConnected = false;
    }

    async connect() {
        if (!this._isConnected) {
            await this.producer.connect();
            this._isConnected = true;
        }
    }

    async sendRequest(topic, uri, data, headers = {}) {
        await this.connect();

        const ctxTxnId = MessageContextHolder.getTransactionId();
        const txnId = ctxTxnId ? ctxTxnId : randomUUID();

        const msg = Message.newRequest(uri, this.config.clusterId, txnId, this.config.responseTopic(), data);
        msg.headers = headers;
        
        return new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(msg.messageId);
                reject(GeneralError.newTimeout(`${topic}/${uri}`));
            }, this.config.requestTimeoutMs);

            this.pendingRequests.set(msg.messageId, { resolve, reject, timeoutId });

            try {
                await this._sendMessageInternal(topic, msg);
            } catch (err) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(msg.messageId);
                reject(err);
            }
        });
    }

    async sendMessage(topic, uri, data) {
        await this.connect();
        const ctxTxnId = MessageContextHolder.getTransactionId();
        const txnId = ctxTxnId ? ctxTxnId : randomUUID();
        
        const msg = Message.newRequest(uri, this.config.clusterId, txnId, null, data);
        msg.messageType = 'MESSAGE';
        await this._sendMessageInternal(topic, msg);
    }

    async sendResponse(original, data) {
        await this.connect();
        if (!original.responseDestination || !original.responseDestination.topic) {
            return;
        }
        const resp = Message.newResponse(original, this.config.clusterId, data);
        await this._sendMessageInternal(original.responseDestination.topic, resp);
    }

    async _sendMessageInternal(topic, msg) {
        const json = JSON.stringify(msg);
        await this.producer.send({
            topic: topic,
            messages: [{ key: msg.messageId, value: json }]
        });
    }

    handleResponse(msg) {
        const mapped = this.pendingRequests.get(msg.messageId);
        if (mapped) {
            this.pendingRequests.delete(msg.messageId);
            clearTimeout(mapped.timeoutId);
            try {
                const resp = this._unwrapResponse(msg);
                mapped.resolve(resp);
            } catch(e) {
                mapped.reject(e);
            }
        } else {
            console.warn(`response for unknown request msgId: ${msg.messageId}`);
        }
    }

    _unwrapResponse(msg) {
        // Cast generic object to Response
        const resp = new Response();
        Object.assign(resp, msg.data);
        
        if (resp.hasError()) {
            const err = new GeneralError(resp.status.code, resp.status.messageParams);
            err.source = resp.status.source;
            err.params = resp.status.params;
            throw err;
        }
        return resp;
    }
}

module.exports = { KafkaClient, GeneralError };
