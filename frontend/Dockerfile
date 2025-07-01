# Use Node.js 18 LTS as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Next.js application
RUN npm run build:docker

# Expose the port the app runs on (HTTPS on port 3000)
EXPOSE 3000

# Start the application with HTTPS using custom server
CMD ["node", "server.js"]
