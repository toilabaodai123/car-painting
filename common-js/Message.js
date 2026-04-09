const { randomUUID } = require('crypto');

class ResponseDestination {
    constructor(topic, uri) {
        this.topic = topic;
        this.uri = uri;
    }
}

class Message {
    constructor() {
        this.messageType = 'MESSAGE';
        this.sourceId = null;
        this.messageId = null;
        this.transactionId = null;
        this.uri = null;
        this.partition = null;
        this.responseDestination = null;
        this.data = null;
        this.timestamp = null;
        this.stream = null;
        this.streamState = null;
        this.streamIndex = null;
    }

    static newMessage(uri, sourceId, data) {
        const msg = new Message();
        msg.messageType = 'MESSAGE';
        msg.messageId = randomUUID();
        msg.transactionId = randomUUID();
        msg.uri = uri;
        msg.sourceId = sourceId;
        msg.data = data;
        msg.timestamp = Date.now();
        return msg;
    }

    static newRequest(uri, sourceId, transactionId, responseTopic, data) {
        const msg = new Message();
        msg.messageType = 'REQUEST';
        msg.messageId = randomUUID();
        msg.transactionId = transactionId || randomUUID();
        msg.uri = uri;
        msg.sourceId = sourceId;
        msg.data = data;
        msg.timestamp = Date.now();
        
        if (responseTopic) {
            msg.responseDestination = new ResponseDestination(responseTopic, uri);
        }
        return msg;
    }

    static newResponse(original, sourceId, data) {
        const msg = new Message();
        msg.messageType = 'RESPONSE';
        msg.messageId = original.messageId;
        msg.transactionId = original.transactionId;
        msg.uri = original.uri;
        msg.sourceId = sourceId;
        msg.data = data;
        msg.timestamp = Date.now();
        return msg;
    }
}

class Status {
    constructor(code = 'SUCCESS') {
        this.code = code;
        this.isSystemError = false;
        this.messageParams = null;
        this.source = null;
        this.params = null;
    }
}

class Response {
    constructor(data = null) {
        this.data = data;
        this.status = null;
    }

    hasError() {
        return this.status && this.status.code;
    }

    static dataResponse(data) {
        return new Response(data);
    }

    static systemErrorResponse(code) {
        const resp = new Response();
        resp.data = null;
        resp.status = new Status(code);
        resp.status.isSystemError = true;
        return resp;
    }
}

module.exports = { Message, ResponseDestination, Response, Status };
