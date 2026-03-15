FROM node:22

# Install Bun (required by opencode to load ESM plugins like opencode-antigravity-auth
# which use directory imports not supported by Node.js ESM but supported by Bun)
RUN apt-get update && apt-get install -y curl unzip bash && \
    curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /usr/src/app

# Install OpenCode CLI globally
RUN npm install -g opencode-ai@latest

# Prepare proxy server
COPY . ./

# Install any dependencies for the proxy (like express)
RUN if [ -f "package.json" ]; then npm install --production; fi

EXPOSE 3284

# Run the proxy server
CMD [ "node", "opencode-proxy.js" ]
