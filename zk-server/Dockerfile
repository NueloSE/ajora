FROM node:20-bookworm-slim

# System deps needed for nargo + bb installation
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install nargo 1.0.0-beta.9 (Noir compiler + prover)
RUN curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
RUN /root/.nargo/bin/noirup --version 1.0.0-beta.9

# Install bbup (the bb version manager) then use it to install bb 0.87.1
RUN curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash
ENV PATH="/root/.bb/bin:$PATH"
RUN bbup --version 0.87.1

ENV PATH="/root/.nargo/bin:/root/.bb/bin:$PATH"

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY . .
RUN npm run build

EXPOSE 8080
ENV PORT=8080

CMD ["npm", "start"]
