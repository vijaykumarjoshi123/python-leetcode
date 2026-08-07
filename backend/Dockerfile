# Node 20+ required: vitest 4 (used by `npm test`) uses util.styleText,
# which does not exist on Node 18 and crashes the test runner on startup.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Install docker CLI so a worker container can invoke `docker run` when
# the container is given access to the host docker socket. This keeps the
# API image small while making the worker image able to spawn executor
# sandboxes when run with /var/run/docker.sock mounted.
RUN apk add --no-cache docker-cli python3

COPY . .

ENV NODE_ENV=production

EXPOSE 5000

CMD ["npm", "start"]
