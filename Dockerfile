# Blindtest 2000 — image de production autonome.
# Un seul service Node : sert le front (public/) + l'API + le WebSocket Socket.IO.
FROM node:22-alpine

WORKDIR /app

# Dépendances d'abord (cache Docker).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code applicatif.
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Render fournit PORT ; défaut local 3000.
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
