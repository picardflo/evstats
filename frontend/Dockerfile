FROM node:20-alpine AS builder

WORKDIR /app
# Le lockfile n'est plus optionnel : npm ci l'exige, et c'est lui qui rend
# le build reproductible (181 dependances transitives figees).
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
