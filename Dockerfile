FROM node:18

RUN apt-get update && apt-get install -y ffmpeg

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --production

COPY . .

CMD ["node","index.js"]
