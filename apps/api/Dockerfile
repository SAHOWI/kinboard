FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kinboard/api...
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["pnpm", "--filter", "@kinboard/api", "start"]
