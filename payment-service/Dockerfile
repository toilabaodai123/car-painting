FROM node:18-alpine

WORKDIR /app

COPY common-js /common-js
COPY payment-service/package*.json ./

RUN npm install

COPY payment-service/index.js ./

EXPOSE 3002

CMD ["node", "index.js"]
