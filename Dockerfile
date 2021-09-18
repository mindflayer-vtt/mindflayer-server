#
# mindflayer-server Dockerfile
#
# https://github.com/shawly/mindflayer-server
#

# Add some build args
ARG NODE_VERSION=14-alpine

# Use Node 14 base image
FROM node-${TARGETARCH:-amd64}${TARGETVARIANT}:${NODE_VERSION}

# Run in production mode
ENV NODE_ENV=production

# Switch to /app directory
WORKDIR /app

# Add node server files to /app directory
ADD . /app

# Install the server dependencies
RUN npm install --production

# Expose the node server port
EXPOSE 10443

# Start the server
CMD [ "npm", "start" ]
