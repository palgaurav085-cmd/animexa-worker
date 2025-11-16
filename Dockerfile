FROM node:18-slim

RUN apt-get update && apt-get install -y ffmpeg

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

CMD ["npm", "start"]
