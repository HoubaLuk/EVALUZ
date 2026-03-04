# Fáze 1: Build
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Fáze 2: Nginx server pro statické assety
FROM nginx:alpine

# Kopírování buildnutých React souborů z předchozího kroku
COPY --from=builder /app/dist /usr/share/nginx/html

# Přepsání default konfigu pro fallback na index.html (React Router)
RUN echo "server { \
    listen 80; \
    location / { \
    root /usr/share/nginx/html; \
    index index.html index.htm; \
    try_files \$uri \$uri/ /index.html; \
    } \
    }" > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
