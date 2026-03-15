FROM node:18-slim
WORKDIR /app
COPY shared/package.json ./shared/
COPY shared/index.js ./shared/
COPY router/package.json ./router/
COPY router/router-service.js router/intent-classifier.js ./router/
WORKDIR /app/router
RUN npm install
EXPOSE 3287
CMD ["npm", "start"]
