FROM node:24-alpine AS build
WORKDIR /workspace
COPY apps/web/package.json ./package.json
RUN npm install --no-audit --no-fund
COPY apps/web/ ./
RUN npm run build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/ /usr/share/nginx/html/
EXPOSE 80
