FROM node:20-alpine

WORKDIR /app

COPY package.json .
COPY seed.js .

RUN npm install

CMD ["node", "seed.js"]