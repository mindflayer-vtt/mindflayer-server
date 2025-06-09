#
# mindflayer-server Dockerfile
#
# https://github.com/mindflayer-vtt/mindflayer-server
#

# Add some build args
ARG NODE_VERSION=22-alpine

# Use Node 14 base image
FROM node:$NODE_VERSION

# Run in production mode
ENV NODE_ENV=production

# Switch to /app directory
WORKDIR /app

# Add node server files to /app directory
ADD . /app

# Install the server dependencies
RUN \
  apk add --update --no-cache --virtual .gyp-fix \
    g++ \
    make \
    python3 \
    git && \
  npm install --production && \
  apk del .gyp-fix

# Expose the node server port
EXPOSE 10443

# Start the server
CMD [ "npm", "start" ]
