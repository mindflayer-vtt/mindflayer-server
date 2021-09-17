# Add some build args
ARG BASE_IMAGE=14-alpine

# Use Node 14 base image
FROM node:${BASE_IMAGE}

# Run in production mode
ENV NODE_ENV=production

# Switch to /app directory
WORKDIR /app

# Add node server files to /app directory
ADD ./server /app

# Add test keypad to /test directory for node server
COPY ./test /test

# Install the server dependencies
RUN npm install --production

# Expose the node server port
EXPOSE 10443

# Start the server
CMD [ "npm", "start" ]