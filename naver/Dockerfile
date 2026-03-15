FROM node:22-slim
WORKDIR /app
COPY shared ./shared
COPY naver ./naver
WORKDIR /app/naver
RUN if [ -f "package.json" ]; then npm install --production; fi
EXPOSE 3285
CMD [ "node", "naver-proxy.js" ]
