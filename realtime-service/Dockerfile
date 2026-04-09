FROM node:18-alpine

WORKDIR /app

COPY realtime-service/package*.json ./

RUN npm install

COPY realtime-service/index.js ./

EXPOSE 3003

CMD ["node", "index.js"]
