FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY mock-payments ./mock-payments

EXPOSE 4000

CMD ["npx", "tsx", "mock-payments/src/server.ts"]