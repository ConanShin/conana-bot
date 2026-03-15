FROM node:22-slim
WORKDIR /app
COPY shared ./shared
COPY email ./email
WORKDIR /app/email
RUN if [ -f "package.json" ]; then npm install --production; fi
EXPOSE 3288
CMD [ "node", "email-proxy.js" ]
