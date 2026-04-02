# Fáze 1: Build React aplikace
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Fáze 2: Nginx server pro statické soubory + reverse proxy na backend
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Adresář pro SSL certifikát (montovaný jako volume z hostitele)
RUN mkdir -p /etc/nginx/ssl

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
