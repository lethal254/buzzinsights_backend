# Use an official Node.js runtime as the base image
FROM node:18

# Install Redis
RUN apt-get update && apt-get install -y redis

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the TypeScript project
RUN npm run build

# Expose the port your app runs on
EXPOSE 4000

# Start Redis and your app
CMD redis-server --daemonize yes && npm start