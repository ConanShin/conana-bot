FROM node:22-slim
WORKDIR /app
COPY shared ./shared
COPY stock ./stock
WORKDIR /app/stock
RUN if [ -f "package.json" ]; then npm install --production; fi
EXPOSE 3286
CMD [ "node", "stock-proxy.js" ]
