FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Install docker CLI so a worker container can invoke `docker run` when
# the container is given access to the host docker socket. This keeps the
# API image small while making the worker image able to spawn executor
# sandboxes when run with /var/run/docker.sock mounted.
RUN apk add --no-cache docker-cli

COPY . .

ENV NODE_ENV=production

EXPOSE 5000

CMD ["npm", "start"]
