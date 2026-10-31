FROM node:24-alpine AS build
WORKDIR /workspace
COPY apps/customer-web/package.json ./package.json
RUN npm install --no-audit --no-fund
COPY apps/customer-web/ ./
# The customer portal imports the shared in-app dialog service from the staff web source.
COPY apps/web/src/dialogs/ /web/src/dialogs/
RUN npm run build

FROM nginx:alpine
COPY apps/customer-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/ /usr/share/nginx/html/
EXPOSE 80
