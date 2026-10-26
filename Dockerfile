FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
USER app
ENV DB_PATH=/data/fitpot.db PORT=3000
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
