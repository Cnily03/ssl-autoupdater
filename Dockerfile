FROM node:20.11.0


COPY . /app
RUN mkdir -p /app/data
COPY ./config.js /app/data/config.js
RUN mkdir -p /app/data/logs

USER root
WORKDIR /app
RUN npm install && npm run build

ENTRYPOINT [ "npm", "run", "docker-log" ]